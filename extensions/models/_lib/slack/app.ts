// Capture in Slack. Each request has one thread in the Capture channel:
// raising a request with /capture logs it, replies in its thread are posted
// on it, and its status changes and agents' turns are posted back. Buttons
// are shown in ephemeral messages, each person seeing only the steps Capture
// would let them take. Every step runs a Capture method as the person
// whose Slack email matches the people list, so Capture's rules decide.
import {
  allowedActions,
  can,
  canRead,
  currentPoint,
  type DiscussionPoint,
  heldByOnePerson,
  isClosed,
  latestSpecification,
  openQuestions,
  type Person,
  possibleDuplicates,
  roleOf,
  specificationProblems,
  standInRole,
  statusWords,
} from "../domain/index.ts";
import type { Stored } from "../capture/ports.ts";
import type { SlackCall } from "./api.ts";
import type { Envelope } from "./socket.ts";
import {
  fieldsToSpec,
  specBlocks,
  specToFields,
  tooLong,
} from "./spec_form.ts";

/** A Capture method's refusal, in Capture's words. */
export class CaptureRefusal extends Error {}

/** Runs one method of the requests behavior; throws CaptureRefusal when refused. */
export type CaptureRun = (
  method: string,
  input: Record<string, unknown>,
) => Promise<void>;

export interface CaptureReader {
  requests(): Promise<Stored[]>;
  people(): Promise<Person[]>;
}

/** Where a request's thread is, and how much of it Slack has been shown. */
export interface ThreadRecord {
  requestId: string;
  channel: string;
  ts: string;
  status: string;
  routerTests: number;
  shownMessages: number;
}

export interface ThreadStore {
  all(): ThreadRecord[];
  save(thread: ThreadRecord): Promise<void>;
}

export interface AppConfig {
  /** The channel requests are discussed in. */
  channel: string;
  /** The stand-in agents, when set up. */
  agents?: { builderAs?: string; requesterAs?: string };
}

export interface AppDeps {
  slack: SlackCall;
  capture: CaptureRun;
  read: CaptureReader;
  threads: ThreadStore;
  /** Has the stand-in take its turn on the request, such as through a workflow. */
  runStandIn?: (
    requestId: string,
    standInAs: string,
    point: DiscussionPoint | undefined,
  ) => Promise<void>;
  log: (message: string, props?: Record<string, unknown>) => void;
}

/** Buttons for Capture's steps, by allowedActions name. */
const BUTTONS: Record<string, string> = {
  submit: "Submit",
  propose: "Propose",
  agree: "Agree",
  requestChanges: "Ask for changes",
  withdraw: "Withdraw",
  join: "Join",
  editSpecification: "Edit spec",
  recordBuildResult: "Record build",
};

/** Steps that take something typed first, so they open a modal. */
const NEEDS_INPUT = new Set([
  "requestChanges",
  "withdraw",
  "editSpecification",
  "recordBuildResult",
]);

/** Status changes posted into the thread. */
const ANNOUNCED: Record<string, string> = {
  agreed: "Agreed",
  building: "Building",
  released: "Released",
};

const plain = (t: string) => ({ type: "plain_text", text: t.slice(0, 150) });
const section = (t: string) => ({
  type: "section",
  text: { type: "mrkdwn", text: t.slice(0, 3_000) },
});

function label(stored: Stored): string {
  return `#${stored.number ?? "?"} ${stored.request.title}`;
}

export function createApp(deps: AppDeps, config: AppConfig) {
  const { slack, capture, read, threads, log } = deps;
  const emails = new Map<string, { email: string; at: number }>();
  /** Messages posted from Slack, not shown again: authorId and body. */
  const fromSlack: string[] = [];
  const agentRunning = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();

  /** One step at a time, so reads and writes don't interleave. */
  function serial<T>(job: () => Promise<T>): Promise<T> {
    const next = queue.then(job, job);
    queue = next.catch(() => {});
    return next;
  }

  /** The Capture person a Slack user is, by email; refuses anyone else. */
  async function whoIs(slackUser: string): Promise<Person> {
    let cached = emails.get(slackUser);
    if (!cached || Date.now() - cached.at > 10 * 60_000) {
      const { user } = await slack("users.info", { user: slackUser }) as {
        user?: { profile?: { email?: string } };
      };
      const email = user?.profile?.email?.trim().toLowerCase();
      if (!email) {
        throw new CaptureRefusal(
          "Slack doesn't show your email, so Capture can't tell who you are.",
        );
      }
      cached = { email, at: Date.now() };
      emails.set(slackUser, cached);
    }
    const person = (await read.people()).find((p) => p.email === cached!.email);
    if (!person || person.standIn) {
      throw new CaptureRefusal(
        `${cached.email} isn't in Capture's people list, so you can't take part here. Ask whoever runs Capture to add you.`,
      );
    }
    return person;
  }

  async function find(requestId: string): Promise<Stored> {
    const stored = (await read.requests()).find((s) =>
      s.request.id === requestId
    );
    if (!stored) throw new CaptureRefusal("There is no such request.");
    return stored;
  }

  const threadOf = (requestId: string) =>
    threads.all().find((t) => t.requestId === requestId);

  function tell(user: string, text: string) {
    return slack("chat.postEphemeral", { channel: config.channel, user, text });
  }

  /** The steps this person may take on the request, as buttons only they see. */
  async function showActions(
    slackUser: string,
    stored: Stored,
    person: Person,
    intro?: string,
  ) {
    const { request } = stored;
    // Proposing is also refused while the spec isn't ready, so it isn't offered.
    const latest = latestSpecification(request);
    const ready = latest?.status === "draft" &&
      specificationProblems(latest.content, request.requestedPhrase).length ===
        0 &&
      openQuestions(request).length === 0;
    const allowed = allowedActions(request, person).filter((a) =>
      a in BUTTONS && (a !== "propose" || ready)
    );
    const elements = allowed.map((a) => ({
      type: "button",
      text: plain(BUTTONS[a]),
      action_id: `capture:${a}`,
      value: request.id,
      ...(a === "agree" && { style: "primary" }),
      ...(a === "withdraw" && { style: "danger" }),
    }));
    const role = roleOf(request, person.userId);
    const questions = role && can(role, "resolveQuestion") &&
        !isClosed(request) && request.status !== "draft"
      ? openQuestions(request)
      : [];
    const blocks: unknown[] = [
      section(
        `${intro ? `${intro}\n` : ""}*${label(stored)}* is ${
          statusWords(request.status)
        }.${
          elements.length === 0 && questions.length === 0
            ? " There is nothing for you to do on it now."
            : ""
        }`,
      ),
    ];
    if (elements.length > 0) blocks.push({ type: "actions", elements });
    for (const q of questions.slice(0, 10)) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Open question from ${q.authorName}: ${q.body}`.slice(0, 3_000),
        },
        accessory: {
          type: "button",
          text: plain("Mark answered"),
          action_id: "capture:resolveQuestion",
          value: `${request.id}|${q.id}`,
        },
      });
    }
    const thread = threadOf(request.id);
    await slack("chat.postEphemeral", {
      channel: thread?.channel ?? config.channel,
      user: slackUser,
      ...(thread && { thread_ts: thread.ts }),
      text: `${label(stored)} is ${statusWords(request.status)}.`,
      blocks,
    });
  }

  /** Runs a Capture step as the person, then has an agent answer if one should. */
  async function act(
    person: Person,
    method: string,
    input: Record<string, unknown>,
    requestId: string,
    then?: { point?: DiscussionPoint; standIn: boolean },
  ) {
    await capture(method, { ...input, as: person.email, id: requestId });
    await syncAll();
    if (then?.standIn) await standIn(requestId, then.point);
  }

  /**
   * The stand-in agent for the role the person isn't playing takes a turn,
   * when one person holds both roles. It runs alone, and its messages reach
   * the thread with the next sync.
   */
  async function standIn(requestId: string, point?: DiscussionPoint) {
    if (!deps.runStandIn || !config.agents) return;
    const stored = await find(requestId);
    const { request } = stored;
    if (request.status === "draft" || isClosed(request)) return;
    if (!heldByOnePerson(request, await read.people())) return;
    const role = standInRole(request.status, point ?? currentPoint(request));
    const as = role === "builder"
      ? config.agents.builderAs
      : config.agents.requesterAs;
    if (!as || agentRunning.has(requestId)) return;
    agentRunning.add(requestId);
    log("The {role} agent takes its turn on {label}", {
      role,
      label: label(stored),
    });
    deps.runStandIn(requestId, as, point)
      .catch((e) =>
        log("The {role} agent's turn on {label} failed: {error}", {
          role,
          label: label(stored),
          error: String(e),
        })
      )
      .finally(() => {
        agentRunning.delete(requestId);
        serial(syncAll).catch(() => {});
      });
  }

  /** Posts a request's thread when it has none, and what changed since. */
  async function sync(stored: Stored, all: Stored[]) {
    const { request } = stored;
    let thread = threadOf(request.id);
    if (!thread) {
      if (request.status === "draft" || isClosed(request)) return;
      const owner = request.participants.find((p) =>
        p.userId === request.outcomeOwnerId
      );
      const posted = await slack("chat.postMessage", {
        channel: config.channel,
        text: `${label(stored)}, raised by ${owner?.name ?? "someone"}`,
        blocks: [
          section(
            `*${label(stored)}*\nRaised by ${owner?.name ?? "someone"}${
              request.requestedPhrase
                ? `, asked as “${request.requestedPhrase}”`
                : ""
            }.\n>${
              request.initialDescription.replaceAll("\n", "\n>") ||
              "(no description)"
            }`,
          ),
          {
            type: "actions",
            elements: [{
              type: "button",
              text: plain("My steps"),
              action_id: "capture:actions",
              value: request.id,
            }],
          },
          {
            type: "context",
            elements: [{
              type: "mrkdwn",
              text:
                "Reply in this thread to discuss it; every reply is kept on the request. Press My steps for what you can do.",
            }],
          },
        ],
      }) as { channel: string; ts: string };
      thread = {
        requestId: request.id,
        channel: posted.channel,
        ts: posted.ts,
        status: request.status,
        routerTests: (request.routerTests ?? []).length,
        shownMessages: 0,
      };
      await threads.save(thread);
      const dupes = possibleDuplicates(request, all);
      if (dupes.length > 0) {
        await post(
          thread,
          `Possible duplicates: ${
            dupes.map((d) => `#${d.number ?? "?"} ${d.title}`).join(", ")
          }. The outcome owner can withdraw this one, or it can be closed as a duplicate in Capture.`,
        );
      }
    }
    const next = { ...thread };
    for (const m of request.messages.slice(thread.shownMessages)) {
      const key = fromSlack.indexOf(`${m.authorId}\u0000${m.body}`);
      if (key >= 0) {
        fromSlack.splice(key, 1);
        continue;
      }
      const agent = (await read.people()).find((p) =>
        p.userId === m.authorId && p.standIn
      );
      const kind = m.kind === "question"
        ? "Question: "
        : m.kind === "decision"
        ? "Decision: "
        : "";
      await post(
        thread,
        agent ? `${kind}${m.body}` : `*${m.authorName}:* ${kind}${m.body}`,
        agent ? `${agent.name} (stand-in)` : undefined,
      );
    }
    next.shownMessages = request.messages.length;
    let routerFailed = false;
    const tests = request.routerTests ?? [];
    for (const t of tests.slice(thread.routerTests)) {
      const missed = t.results.filter((r) => r.outcome === "not-answered");
      if (missed.length === 0) continue;
      routerFailed = true;
      await post(
        thread,
        `:x: Router test of ${t.version} failed: ${
          missed.map((r) => `“${r.phrase}”${r.note ? ` (${r.note})` : ""}`)
            .join(", ")
        } wasn't answered.`,
      );
    }
    next.routerTests = tests.length;
    const moved = request.status !== thread.status;
    if (moved && ANNOUNCED[request.status]) {
      const spec = latestSpecification(request);
      await post(
        thread,
        `*${ANNOUNCED[request.status]}*${
          request.status === "agreed" && spec
            ? ` (version ${spec.version})`
            : ""
        }`,
      );
    }
    next.status = request.status;
    if (JSON.stringify(next) !== JSON.stringify(thread)) {
      await threads.save(next);
    }
    // Changes made outside Slack that are discussion points.
    if (routerFailed) await standIn(request.id, "router_test");
    else if (
      moved && thread.status !== "draft" &&
      request.status === "ready_for_agreement" &&
      latestSpecification(request)?.changeSummary &&
      request.agreements.length > 0
    ) {
      await standIn(request.id, "revision");
    }
  }

  function post(thread: ThreadRecord, text: string, username?: string) {
    return slack("chat.postMessage", {
      channel: thread.channel,
      thread_ts: thread.ts,
      text,
      ...(username && { username }),
    });
  }

  async function syncAll() {
    const all = await read.requests();
    for (const stored of all) {
      try {
        await sync(stored, all);
      } catch (e) {
        log("Couldn't post {label} to Slack: {error}", {
          label: label(stored),
          error: String(e),
        });
      }
    }
  }

  function openModal(
    trigger: string,
    callback: string,
    meta: Record<string, string>,
    title: string,
    blocks: unknown[],
    submit = "Save",
  ) {
    return slack("views.open", {
      trigger_id: trigger,
      view: {
        type: "modal",
        callback_id: callback,
        private_metadata: JSON.stringify(meta),
        title: plain(title.slice(0, 24)),
        submit: plain(submit),
        close: plain("Cancel"),
        blocks,
      },
    });
  }

  const input = (
    id: string,
    title: string,
    multiline = true,
    optional = false,
  ) => ({
    type: "input",
    block_id: id,
    optional,
    label: plain(title),
    element: { type: "plain_text_input", action_id: "v", multiline },
  });

  async function raiseModal(trigger: string) {
    await openModal(trigger, "capture:raise", {}, "Raise a request", [
      input("title", "Title", false),
      input("description", "What is wanted"),
      input("currentProcess", "How it is done today", true, true),
      input(
        "phrase",
        "The phrase someone would ask, if there is one",
        false,
        true,
      ),
    ], "Raise");
  }

  /** A button pressed: run the step, or open its modal. */
  async function pressed(payload: Record<string, unknown>) {
    const user = (payload.user as { id: string }).id;
    const trigger = payload.trigger_id as string;
    const [action] = payload.actions as { action_id: string; value: string }[];
    const name = action.action_id.replace(/^capture:/, "");
    const person = await whoIs(user);
    if (name === "resolveQuestion") {
      const [requestId, questionId] = action.value.split("|");
      await act(person, "resolve_question", { questionId }, requestId, {
        standIn: true,
      });
      return showActions(
        user,
        await find(requestId),
        person,
        "Marked answered.",
      );
    }
    const stored = await find(action.value);
    const { request } = stored;
    if (name === "actions") return showActions(user, stored, person);
    if (NEEDS_INPUT.has(name)) {
      const meta = { requestId: request.id, user };
      if (name === "requestChanges") {
        return openModal(
          trigger,
          "capture:requestChanges",
          meta,
          "Ask for changes",
          [
            input("note", "What should change"),
          ],
          "Send back",
        );
      }
      if (name === "withdraw") {
        return openModal(trigger, "capture:withdraw", meta, "Withdraw", [
          input("reason", "Why it is withdrawn", true, true),
        ], "Withdraw");
      }
      if (name === "recordBuildResult") {
        return openModal(
          trigger,
          "capture:recordBuildResult",
          meta,
          "Record build",
          [
            input(
              "result",
              "The build-result file: an https URL, a path in the Capture repository, or its JSON",
            ),
          ],
          "Record",
        );
      }
      const content = latestSpecification(request)?.content;
      const values = specToFields(content);
      const long = tooLong(values);
      if (long) {
        throw new CaptureRefusal(
          `${long} is longer than Slack lets a field be; edit this spec with edit_specification instead.`,
        );
      }
      return openModal(
        trigger,
        "capture:editSpecification",
        meta,
        "Edit spec",
        specBlocks(values, content?.effects?.kind),
      );
    }
    const method: Record<string, string> = {
      submit: "submit",
      propose: "propose",
      agree: "agree",
      join: "join_request",
    };
    if (!method[name]) return;
    await act(
      person,
      method[name],
      name === "agree"
        ? { version: latestSpecification(request)?.version ?? 0 }
        : {},
      request.id,
      // Agreeing, joining and proposing need no agent; submitting starts the talk.
      name === "submit"
        ? {
          standIn: true,
          point: possibleDuplicates(request, await read.requests()).length > 0
            ? "duplicates"
            : "clarify",
        }
        : undefined,
    );
    await showActions(
      user,
      await find(request.id),
      person,
      `${BUTTONS[name]}: done.`,
    );
  }

  /** A modal sent: raise the request or take the step it was for. */
  async function submitted(payload: Record<string, unknown>) {
    const user = (payload.user as { id: string }).id;
    const view = payload.view as {
      id: string;
      callback_id: string;
      private_metadata: string;
      state: {
        values: Record<
          string,
          {
            v: {
              value?: string | null;
              selected_option?: { value: string } | null;
            };
          }
        >;
      };
    };
    const value = (id: string) => view.state.values[id]?.v?.value ?? "";
    const person = await whoIs(user);
    const name = view.callback_id.replace(/^capture:/, "");
    if (name === "raise") {
      const key = `slack-${view.id}`;
      await capture("create_request", {
        as: person.email,
        title: value("title"),
        description: value("description"),
        currentProcess: value("currentProcess"),
        phrase: value("phrase"),
        idempotencyKey: key,
      });
      const stored = (await read.requests()).find((s) =>
        s.idempotencyKeys.some((k) =>
          k.userId === person.userId && k.key === key
        )
      );
      if (stored) {
        await showActions(
          user,
          stored,
          person,
          "Logged as a draft, which only you can see. Submit it to start its thread.",
        );
      }
      return;
    }
    const { requestId } = JSON.parse(view.private_metadata) as {
      requestId: string;
    };
    if (name === "requestChanges") {
      await act(person, "request_changes", { note: value("note") }, requestId, {
        standIn: true,
        point: "proposal",
      });
    } else if (name === "withdraw") {
      await act(person, "withdraw", { reason: value("reason") }, requestId);
    } else if (name === "recordBuildResult") {
      await capture("record_build_result", {
        as: person.email,
        result: value("result").trim(),
      });
      await syncAll();
    } else if (name === "editSpecification") {
      const fields = Object.fromEntries(
        Object.keys(view.state.values).map((k) => [k, value(k)]),
      );
      const effects = view.state.values.effects?.v?.selected_option?.value ??
        "";
      await act(
        person,
        "edit_specification",
        {
          specification: fieldsToSpec(fields, effects),
        },
        requestId,
        { standIn: true },
      );
    } else return;
    await showActions(user, await find(requestId), person, "Done.");
  }

  /** A reply in a request's thread is posted on the request as the person. */
  async function replied(event: Record<string, unknown>) {
    if (event.subtype || event.bot_id || !event.thread_ts) return;
    const thread = threads.all().find((t) =>
      t.channel === event.channel && t.ts === event.thread_ts
    );
    if (!thread) return;
    const user = event.user as string;
    const body = String(event.text ?? "").trim();
    if (!body) return;
    const person = await whoIs(user);
    fromSlack.push(`${person.userId}\u0000${body}`);
    try {
      await act(
        person,
        "post_message",
        { kind: "comment", body },
        thread.requestId,
        {
          standIn: true,
        },
      );
    } catch (e) {
      fromSlack.pop();
      throw e;
    }
  }

  async function command(payload: Record<string, unknown>) {
    const user = payload.user_id as string;
    const text = String(payload.text ?? "").trim();
    const person = await whoIs(user);
    if (!text) return raiseModal(payload.trigger_id as string);
    const number = /^#?(\d+)$/.exec(text)?.[1];
    const stored = number &&
      (await read.requests()).find((s) => s.number === Number(number));
    if (!stored || !canRead(stored.request, person)) {
      throw new CaptureRefusal(
        "Say /capture to raise a request, or /capture 12 for your steps on #12, one you can see.",
      );
    }
    await showActions(user, stored, person);
  }

  /** Says a refusal to the person it is for, in Capture's words. */
  async function refuse(user: string | undefined, e: unknown) {
    if (!(e instanceof CaptureRefusal)) throw e;
    log("Refused: {message}", { message: e.message });
    if (user) await tell(user, e.message);
  }

  return {
    whoIs,
    /** Handles one Socket Mode envelope. */
    handle(envelope: Envelope): Promise<void> {
      const payload = envelope.payload ?? {};
      return serial(async () => {
        let user: string | undefined;
        try {
          if (envelope.type === "slash_commands") {
            user = payload.user_id as string;
            await command(payload);
          } else if (envelope.type === "interactive") {
            user = (payload.user as { id?: string })?.id;
            if (payload.type === "block_actions") await pressed(payload);
            if (payload.type === "view_submission") await submitted(payload);
          } else if (envelope.type === "events_api") {
            const event = payload.event as Record<string, unknown>;
            user = event?.user as string | undefined;
            if (event?.type === "message") await replied(event);
          }
        } catch (e) {
          await refuse(user, e);
        }
      });
    },
    /** Posts threads and what changed in Capture since the last look. */
    poll: () => serial(syncAll),
  };
}
