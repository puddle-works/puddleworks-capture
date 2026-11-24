// The Slack app against a fake Slack and the real Capture methods on a fake
// swamp, so Capture's own rules decide every step.
import { describe, expect, it } from "../domain/test_bdd.ts";
import { goodSpec } from "../domain/test_fixtures.ts";
import { FakeSwamp } from "../capture/fake_swamp.ts";
import { fromResource, toPerson } from "../capture/swamp_store.ts";
import { model } from "../../capture.ts";
import { CaptureRefusal, createApp, type ThreadRecord } from "./app.ts";

const SLACK_EMAILS: Record<string, string> = {
  U_SOL: "sol@example.com",
  U_OLIVE: "olive@example.com",
  U_BEA: "bea@example.com",
  U_EVE: "eve@example.com",
};

function setup() {
  const swamp = new FakeSwamp();
  const context = swamp.context(model.globalArguments.parse({}));
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  let ts = 0;
  const slack = (method: string, body: Record<string, unknown>) => {
    calls.push({ method, body });
    if (method === "users.info") {
      const email = SLACK_EMAILS[body.user as string];
      return Promise.resolve({ ok: true, user: { profile: { email } } });
    }
    if (method === "chat.postMessage") {
      return Promise.resolve({ ok: true, channel: "C1", ts: `${++ts}.0` });
    }
    return Promise.resolve({ ok: true });
  };
  const ran: { method: string; input: Record<string, unknown> }[] = [];
  const capture = async (method: string, input: Record<string, unknown>) => {
    ran.push({ method, input });
    const m = model.methods[method as keyof typeof model.methods];
    try {
      // deno-lint-ignore no-explicit-any
      await (m.execute as any)(m.arguments.parse(input), context);
    } catch (e) {
      throw new CaptureRefusal(String((e as Error).message));
    }
  };
  const read = {
    requests: () =>
      Promise.resolve(
        swamp.latest().filter((r) => r.specName === "request").map((r) =>
          fromResource(structuredClone(r.attributes))
        ),
      ),
    people: () =>
      Promise.resolve(
        swamp.latest().filter((r) => r.specName === "person").map((r) =>
          toPerson(r.attributes)
        ),
      ),
  };
  const saved = new Map<string, ThreadRecord>();
  const threads = {
    all: () => [...saved.values()],
    save: (t: ThreadRecord) => {
      saved.set(t.requestId, t);
      return Promise.resolve();
    },
  };
  const standIns: { requestId: string; as: string; point?: string }[] = [];
  const app = createApp({
    slack,
    capture,
    read,
    threads,
    log: () => {},
    runStandIn: (requestId, as, point) => {
      standIns.push({ requestId, as, point });
      return Promise.resolve();
    },
  }, {
    channel: "C1",
    agents: {
      builderAs: "builder-agent@example.com",
      requesterAs: "requester-agent@example.com",
    },
  });

  const add = (input: Record<string, unknown>) => capture("add_person", input);
  const press = (user: string, action: string, value: string) =>
    app.handle({
      type: "interactive",
      envelope_id: "e",
      payload: {
        type: "block_actions",
        user: { id: user },
        trigger_id: "t",
        actions: [{ action_id: `capture:${action}`, value }],
      },
    });
  const send = (
    user: string,
    callback: string,
    values: Record<string, string>,
    meta: Record<string, string> = {},
  ) =>
    app.handle({
      type: "interactive",
      envelope_id: "e",
      payload: {
        type: "view_submission",
        user: { id: user },
        view: {
          id: `V${Math.random()}`,
          callback_id: `capture:${callback}`,
          private_metadata: JSON.stringify(meta),
          state: {
            values: Object.fromEntries(
              Object.entries(values).map(([k, v]) => [k, { v: { value: v } }]),
            ),
          },
        },
      },
    });
  const reply = (user: string, thread: ThreadRecord, text: string) =>
    app.handle({
      type: "events_api",
      envelope_id: "e",
      payload: {
        event: {
          type: "message",
          user,
          channel: thread.channel,
          thread_ts: thread.ts,
          text,
        },
      },
    });
  /** The buttons the last message to `user` offered. */
  const buttons = (user: string) => {
    const last = calls.findLast((c) =>
      c.method === "chat.postEphemeral" && c.body.user === user
    );
    const blocks = (last?.body.blocks ?? []) as {
      type: string;
      elements?: { text: { text: string } }[];
    }[];
    return blocks.filter((b) => b.type === "actions").flatMap((b) =>
      b.elements!.map((e) => e.text.text)
    );
  };
  const lastSaid = (user: string) =>
    String(
      calls.findLast((c) =>
        c.method === "chat.postEphemeral" && c.body.user === user
      )?.body.text,
    );
  const threadPosts = () =>
    calls.filter((c) => c.method === "chat.postMessage" && c.body.thread_ts)
      .map((c) => String(c.body.text));

  return {
    swamp,
    app,
    calls,
    ran,
    read,
    threads,
    standIns,
    add,
    press,
    send,
    reply,
    buttons,
    lastSaid,
    threadPosts,
  };
}

/** Raises and submits a request as `user`; returns its id and thread. */
async function raised(t: ReturnType<typeof setup>, user: string) {
  await t.send(user, "raise", {
    title: "Stock counts",
    description: "We count stock every Friday.",
    currentProcess: "Paper",
    phrase: "",
  });
  const [stored] = await t.read.requests();
  await t.press(user, "submit", stored.request.id);
  return { id: stored.request.id, thread: t.threads.all()[0] };
}

describe("Capture in Slack", () => {
  it("refuses a Slack user who isn't in the people list, and runs nothing", async () => {
    const t = setup();
    await t.send("U_EVE", "raise", { title: "x", description: "y" });
    expect(t.lastSaid("U_EVE")).toContain("isn't in Capture's people list");
    expect(t.ran).toEqual([]);
  });

  it("acts as the person whose Slack email matches, whatever the payload says", async () => {
    const t = setup();
    await t.add({ email: "olive@example.com", name: "Olive Owner" });
    await t.app.handle({
      type: "interactive",
      envelope_id: "e",
      payload: {
        type: "view_submission",
        user: { id: "U_OLIVE" },
        view: {
          id: "V1",
          callback_id: "capture:raise",
          private_metadata: JSON.stringify({ as: "bea@example.com" }),
          state: {
            values: {
              title: { v: { value: "Stock" } },
              description: { v: { value: "d" } },
              as: { v: { value: "bea@example.com" } },
            },
          },
        },
      },
    });
    expect(t.ran.at(-1)?.input.as).toBe("olive@example.com");
  });

  it("gives each request one thread, and records replies in it on the request", async () => {
    const t = setup();
    await t.add({ email: "olive@example.com", name: "Olive Owner" });
    await t.add({ email: "bea@example.com", name: "Bea", builder: "true" });
    const { id, thread } = await raised(t, "U_OLIVE");
    expect(t.threads.all().length).toBe(1);
    await t.reply("U_OLIVE", thread, "It's for the Friday count.");
    await t.app.poll();
    const [stored] = await t.read.requests();
    expect(stored.request.id).toBe(id);
    expect(stored.request.messages.map((m) => [m.authorName, m.body])).toEqual(
      [["Olive Owner", "It's for the Friday count."]],
    );
    // Not posted back: it is already in the thread.
    expect(t.threadPosts().some((p) => p.includes("Friday count"))).toBe(false);
    // Someone not on the request can't reply onto it.
    await t.reply("U_BEA", thread, "Hello");
    expect(t.lastSaid("U_BEA")).toContain("aren't part of this request");
  });

  it("shows each role only its buttons, as Capture allows them", async () => {
    const t = setup();
    await t.add({ email: "olive@example.com", name: "Olive Owner" });
    await t.add({ email: "bea@example.com", name: "Bea", builder: "true" });
    const { id } = await raised(t, "U_OLIVE");
    await t.press("U_BEA", "actions", id);
    expect(t.buttons("U_BEA")).toEqual(["Join"]);
    await t.press("U_BEA", "join", id);
    expect(t.buttons("U_BEA")).toEqual(["Edit spec"]);
    await t.press("U_OLIVE", "actions", id);
    // Capture lets the owner write the spec too; an empty one isn't proposed.
    expect(t.buttons("U_OLIVE")).toEqual(["Withdraw", "Edit spec"]);
    await t.send("U_BEA", "editSpecification", {
      problemStatement: goodSpec.problemStatement,
      desiredOutcome: goodSpec.desiredOutcome,
      scopeIn: "Entering counts",
      criteria: "AC1: A count takes under a minute",
      examples: "what should I order this week => Each item to order",
      whenEmpty: "Nothing needs ordering.",
    }, { requestId: id });
    expect(t.buttons("U_BEA")).toEqual(["Propose", "Edit spec"]);
    await t.press("U_BEA", "propose", id);
    expect(t.buttons("U_BEA")).toEqual(["Ask for changes"]);
    await t.press("U_OLIVE", "actions", id);
    expect(t.buttons("U_OLIVE")).toEqual([
      "Ask for changes",
      "Agree",
      "Withdraw",
    ]);
    await t.press("U_OLIVE", "agree", id);
    expect(t.threadPosts()).toContain("*Agreed* (version 1)");
    await t.press("U_BEA", "actions", id);
    expect(t.buttons("U_BEA")).toEqual(["Record build"]);
    // A different builder means no stand-in joins.
    expect(t.standIns).toEqual([]);
  });

  it("posts a failed router test into the request's thread", async () => {
    const t = setup();
    await t.add({ email: "olive@example.com", name: "Olive Owner" });
    await t.add({ email: "bea@example.com", name: "Bea", builder: "true" });
    const { id } = await raised(t, "U_OLIVE");
    await t.press("U_BEA", "join", id);
    await t.ran.length; // keep order
    const capture = async (method: string, input: Record<string, unknown>) => {
      const m = model.methods[method as keyof typeof model.methods];
      // deno-lint-ignore no-explicit-any
      await (m.execute as any)(
        m.arguments.parse(input),
        t.swamp.context(model.globalArguments.parse({})),
      );
    };
    await capture("edit_specification", {
      as: "bea@example.com",
      id,
      specification: goodSpec,
    });
    await capture("propose", { as: "bea@example.com", id });
    await capture("agree", { as: "olive@example.com", id, version: 1 });
    const result = {
      apiVersion: "puddleworks.dev/build-result/v2",
      kind: "BuildResult",
      name: "stock-counts",
      extension: "@example/stock-counts",
      entryPointRef: "@example/stock-counts",
      repository: "https://github.com/example/stock-counts",
      buildRef: "main",
      pullRequest: "https://github.com/example/stock-counts/pull/1",
      source: {
        url: `http://127.0.0.1:3002/requests/${id}`,
        version: 1,
        specHash: (await t.read.requests())[0].request.agreements[0].specHash,
      },
      published: { version: "2026.11.22.1", visibility: "public" },
      examples: [{ phrase: "what should I order this week", passed: true }],
      recipe: {
        id: "stock-counts",
        phrases: ["what should I order this week"],
        empty: "Nothing needs ordering.",
      },
      builtAt: "2026-11-22T10:00:00.000Z",
    };
    await t.send("U_BEA", "recordBuildResult", {
      result: JSON.stringify(result),
    }, { requestId: id });
    expect(t.threadPosts()).toContain("*Building*");
    await capture("record_router_test", {
      as: "olive@example.com",
      id,
      version: "2026.11.22.1",
      results: [{
        phrase: "what should I order this week",
        outcome: "not-answered",
        note: "went to Claude",
      }],
    });
    await t.app.poll();
    expect(t.threadPosts().at(-1)).toBe(
      ":x: Router test of 2026.11.22.1 failed: “what should I order this week” (went to Claude) wasn't answered.",
    );
  });

  it("brings in the builder agent before Agreed when one person is both, and the requester agent after", async () => {
    const t = setup();
    await t.add({
      email: "sol@example.com",
      name: "Sol Solo",
      builder: "true",
    });
    await t.add({
      email: "builder-agent@example.com",
      name: "Builder agent",
      standIn: "builder",
    });
    await t.add({
      email: "requester-agent@example.com",
      name: "Requester agent",
      standIn: "requester",
    });
    const { id, thread } = await raised(t, "U_SOL");
    expect(t.standIns.at(-1)).toEqual({
      requestId: id,
      as: "builder-agent@example.com",
      point: "clarify",
    });
    // The agent's turn, as the workflow records it, reaches the thread under its own name.
    await t.ran.length;
    const m = model.methods.record_stand_in_turn;
    // deno-lint-ignore no-explicit-any
    await (m.execute as any)(
      m.arguments.parse({
        as: "builder-agent@example.com",
        id,
        turn: {
          messages: [{ kind: "comment", body: "Who counts, and when?" }],
          specification: goodSpec,
          propose: true,
        },
      }),
      t.swamp.context(model.globalArguments.parse({})),
    );
    await t.app.poll();
    const posted = t.calls.findLast((c) =>
      c.method === "chat.postMessage" && c.body.thread_ts === thread.ts
    );
    expect([posted?.body.username, posted?.body.text]).toEqual([
      "Builder agent (stand-in)",
      "Who counts, and when?",
    ]);
    await t.press("U_SOL", "actions", id);
    expect(t.buttons("U_SOL")).toEqual([
      "Ask for changes",
      "Agree",
      "Withdraw",
    ]);
    await t.press("U_SOL", "agree", id);
    await t.reply("U_SOL", thread, "Starting on it now.");
    expect(t.standIns.at(-1)?.as).toBe("requester-agent@example.com");
  });
});
