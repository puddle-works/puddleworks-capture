// What the Slack app offers people, in the Capture app: each person's steps
// on a request, as Capture's rules decide them (allowedActions), and the
// status changes Slack announces. Under swamp serve the signed-in person
// takes the steps Slack has buttons for (act.ts); on the local dashboard,
// where apps can't run anything, a step is shown with its command.
import { Fragment, h } from "preact";
import type { Stored } from "../../../models/_lib/capture/ports.ts";
import {
  type AllowedAction,
  allowedActions,
  readyToPropose,
} from "../../../models/_lib/domain/allowed.ts";
import { openQuestions } from "../../../models/_lib/domain/discussion.ts";
import { isClosed } from "../../../models/_lib/domain/lifecycle.ts";
import type { Person } from "../../../models/_lib/domain/model.ts";
import { can, roleOf } from "../../../models/_lib/domain/permissions.ts";
import { latestSpecification } from "../../../models/_lib/domain/specification.ts";
import {
  FIELDS,
  fieldsToSpec,
  specToFields,
} from "../../../models/_lib/slack/spec_form.ts";
import { formatTime } from "../../../models/_lib/web/page/words.ts";

/** Each step's name, its method, and whether it takes more inputs. */
export const STEPS: Record<AllowedAction, [string, string, boolean]> = {
  submit: ["Submit", "submit", false],
  propose: ["Propose", "propose", false],
  agree: ["Agree", "agree", true],
  requestChanges: ["Ask for changes", "request_changes", false],
  revise: ["Revise", "revise", false],
  withdraw: ["Withdraw", "withdraw", false],
  decline: ["Decline", "decline", true],
  build: ["Build", "start_building", false],
  release: ["Release", "record_build_result", true],
  join: ["Join", "join_request", false],
  editDetails: ["Edit details", "edit_details", true],
  editSpecification: ["Edit spec", "edit_specification", true],
  startBuilding: ["Start building", "start_building", false],
  recordBuildResult: ["Record build", "record_build_result", true],
  recordRouterTest: ["Record router test", "record_router_test", true],
  export: ["Export", "export_outcome_spec", false],
  message: ["Reply", "post_message", true],
  invite: ["Invite", "invite", true],
  transferOwnership: ["Transfer ownership", "transfer_ownership", true],
};

/**
 * Steps that wait on this person, for "Waiting on you": the request goes no
 * further until they take one. Steps anyone on it could take at any time,
 * such as joining or editing the spec, aren't counted, and nor are build
 * and router-test steps once the request is released.
 */
const MOVES: readonly AllowedAction[] = [
  "submit",
  "propose",
  "agree",
  "startBuilding",
  "recordBuildResult",
  "recordRouterTest",
];

export function waitingSteps(stored: Stored, person: Person): AllowedAction[] {
  const released = stored.request.status === "released";
  return stepsFor(stored, person).filter((a) =>
    MOVES.includes(a) &&
    !(released && (a === "recordBuildResult" || a === "recordRouterTest"))
  );
}

/** A shell word: quoted unless it is plainly safe. */
const word = (v: string) =>
  /^[A-Za-z0-9@._+#=-]+$/.test(v) ? v : `'${v.replaceAll("'", `'\\''`)}'`;

const label = (s: Stored) => `#${s.number ?? "?"} ${s.request.title}`;
const href = (s: Stored) => `/requests/${encodeURIComponent(s.request.id)}`;

export function stepsFor(stored: Stored, person: Person): AllowedAction[] {
  return allowedActions(stored.request, person);
}

/** The command that takes a step, as the person. */
export function stepCommand(
  behavior: string,
  stored: Stored,
  person: Person,
  action: AllowedAction,
): string {
  const [, method, more] = STEPS[action];
  // record_build_result finds the request from the result it is given.
  const id = method === "record_build_result"
    ? ""
    : ` --input id=${stored.number ?? stored.request.id}`;
  return `swamp behavior run ${behavior} ${method}${id} --input ${
    word(`as=${person.email}`)
  }${more ? " …" : ""}`;
}

/** A status change Slack would announce. */
export interface Change {
  stored: Stored;
  at: string;
  text: string;
  failed: boolean;
}

const ANNOUNCED: Record<string, string> = {
  agreed: "Agreed",
  building: "Building",
  released: "Released",
};

/** Agreed, Building, Released and failed router tests, newest first. */
export function recentChanges(requests: Stored[], limit = 5): Change[] {
  const changes: Change[] = [];
  for (const stored of requests) {
    const r = stored.request;
    for (const t of r.transitions) {
      if (t.from === t.to || !ANNOUNCED[t.to]) continue;
      const agreed = t.to === "agreed" &&
        r.agreements.find((a) => a.agreedAt === t.at);
      changes.push({
        stored,
        at: t.at,
        text: `${ANNOUNCED[t.to]}${
          agreed ? ` (version ${agreed.specVersion})` : ""
        }`,
        failed: false,
      });
    }
    for (const test of r.routerTests ?? []) {
      const missed = test.results.filter((x) => x.outcome === "not-answered");
      if (missed.length === 0) continue;
      changes.push({
        stored,
        at: test.recordedAt,
        text: `Router test of ${test.version} failed: ${
          missed.map((x) => `“${x.phrase}”${x.note ? ` (${x.note})` : ""}`)
            .join(", ")
        } wasn't answered`,
        failed: true,
      });
    }
  }
  return changes.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Who is viewing: a swamp login Capture knows, or why it doesn't. */
export type Acting =
  | { kind: "picker" }
  | { kind: "checking" }
  | { kind: "signedIn"; person: Person }
  | { kind: "refused"; reason: string };

/** The panel's state, kept by the page across re-reads. */
export interface PanelState {
  /** The step whose form is open, such as "withdraw" or "raise". */
  open: string | null;
  /** What has been typed, by form field name. */
  drafts: Record<string, string>;
  busy: boolean;
  flash: { text: string; error: boolean } | null;
}

/** The steps the Slack app offers as buttons; the rest stay commands. */
const BUTTONS: readonly AllowedAction[] = [
  "submit",
  "propose",
  "agree",
  "requestChanges",
  "withdraw",
  "join",
  "editSpecification",
  "recordBuildResult",
];

/** Steps that take something typed first, so they open a form. */
const NEEDS_INPUT = new Set([
  "requestChanges",
  "withdraw",
  "editSpecification",
  "recordBuildResult",
  "raise",
]);

/** The buttons this person gets on the request, as the Slack app gives them. */
export function offeredButtons(
  stored: Stored,
  person: Person,
): AllowedAction[] {
  const ready = readyToPropose(stored.request);
  return stepsFor(stored, person).filter((a) =>
    BUTTONS.includes(a) && (a !== "propose" || ready)
  );
}

type Send = (inputs: Record<string, string | number>, done: string) => void;

function field(
  state: PanelState,
  name: string,
  label: string,
  opts: {
    initial?: string;
    multiline?: boolean;
    required?: boolean;
    hint?: string;
  } = {},
) {
  const value = state.drafts[name] ?? opts.initial ?? "";
  return h(
    "label",
    { class: "app-field", key: name },
    h("span", null, label, opts.hint && h("small", null, ` ${opts.hint}`)),
    opts.multiline === false
      ? h("input", { name, value, required: opts.required })
      : h("textarea", { name, value, rows: 3, required: opts.required }),
  );
}

/** The form a step opens, filled from what was typed or what is there. */
function stepForm(
  step: string,
  stored: Stored | null,
  state: PanelState,
  send: Send,
  onOpen: (step: string | null) => void,
) {
  const id = stored?.request.id ?? "";
  let fields: unknown[] = [];
  let label = "Save";
  let read: (v: (name: string) => string) => Record<string, string> =
    () => ({});
  if (step === "raise") {
    label = "Raise";
    fields = [
      field(state, "title", "Title", { multiline: false, required: true }),
      field(state, "description", "What is wanted", { required: true }),
      field(state, "currentProcess", "How it is done today"),
      field(state, "phrase", "The phrase someone would ask, if there is one", {
        multiline: false,
      }),
    ];
    read = (v) => ({
      title: v("title"),
      description: v("description"),
      currentProcess: v("currentProcess"),
      phrase: v("phrase"),
      // One per form opened, so a retried step logs one request.
      idempotencyKey: state.drafts.idempotencyKey ?? crypto.randomUUID(),
    });
  } else if (step === "requestChanges") {
    label = "Send back";
    fields = [field(state, "note", "What should change", { required: true })];
    read = (v) => ({ note: v("note") });
  } else if (step === "withdraw") {
    label = "Withdraw";
    fields = [field(state, "reason", "Why it is withdrawn")];
    read = (v) => ({ reason: v("reason") });
  } else if (step === "recordBuildResult") {
    label = "Record";
    fields = [
      field(state, "result", "The build result: its https URL, or its JSON", {
        required: true,
      }),
    ];
    read = (v) => ({ result: v("result") });
  } else if (step === "editSpecification" && stored) {
    const content = latestSpecification(stored.request)?.content;
    const values = specToFields(content);
    fields = [
      ...FIELDS.map((f) =>
        field(state, `spec.${f.id}`, f.label, {
          initial: values[f.id],
          multiline: f.multiline ?? false,
          required: !f.optional,
          hint: f.hint,
        })
      ),
      h(
        "label",
        { class: "app-field", key: "spec.effects" },
        h("span", null, "Reads or writes"),
        h(
          "select",
          {
            name: "spec.effects",
            value: state.drafts["spec.effects"] ?? content?.effects?.kind ?? "",
          },
          h("option", { value: "" }, "Keep the one there"),
          h("option", { value: "read" }, "It only reads"),
          h("option", { value: "write" }, "It changes things"),
        ),
      ),
    ];
    read = (v) => ({
      specification: JSON.stringify(
        fieldsToSpec(
          Object.fromEntries(FIELDS.map((f) => [f.id, v(`spec.${f.id}`)])),
          v("spec.effects"),
        ),
      ),
    });
  }
  return h(
    "form",
    {
      class: "app-form",
      onSubmit: (e: Event) => {
        e.preventDefault();
        const form = e.currentTarget as HTMLFormElement;
        const data = new FormData(form);
        const v = (name: string) => String(data.get(name) ?? "");
        const name = step === "raise"
          ? "Raised"
          : STEPS[step as AllowedAction][0];
        send({ step, id, ...read(v) }, `${name}: done.`);
      },
    },
    fields,
    h(
      "div",
      { class: "app-buttons" },
      h("button", { type: "submit", disabled: state.busy }, label),
      h(
        "button",
        { type: "button", class: "quiet", onClick: () => onOpen(null) },
        "Cancel",
      ),
    ),
  );
}

/** Buttons for the signed-in person's steps on the request, as in Slack. */
function actionsFor(
  stored: Stored,
  person: Person,
  state: PanelState,
  send: Send,
  onOpen: (step: string | null) => void,
) {
  const { request } = stored;
  const id = request.id;
  const offered = offeredButtons(stored, person);
  const allowed = stepsFor(stored, person);
  const role = roleOf(request, person.userId);
  const questions = role && can(role, "resolveQuestion") &&
      !isClosed(request) && request.status !== "draft"
    ? openQuestions(request)
    : [];
  // Agree names the version on screen, so a page left open can't agree to a newer one.
  const shown = latestSpecification(request)?.version ?? 0;
  const buttons = offered.map((a) =>
    h(
      "button",
      {
        key: a,
        type: "button",
        disabled: state.busy,
        class: a === "agree"
          ? "primary"
          : a === "withdraw"
          ? "danger"
          : undefined,
        "aria-expanded": NEEDS_INPUT.has(a)
          ? String(state.open === a)
          : undefined,
        onClick: () =>
          NEEDS_INPUT.has(a) ? onOpen(state.open === a ? null : a) : send(
            a === "agree" ? { step: a, id, version: shown } : { step: a, id },
            `${STEPS[a][0]}: done.`,
          ),
      },
      a === "agree" ? `Agree to version ${shown}` : STEPS[a][0],
    )
  );
  const others = allowed.filter((a) => !BUTTONS.includes(a) && a !== "message");
  return h(
    Fragment,
    null,
    buttons.length > 0
      ? h("div", { class: "app-buttons" }, buttons)
      : questions.length === 0 &&
        h("p", { class: "empty" }, "Nothing for you to do on this request."),
    state.open && NEEDS_INPUT.has(state.open) && state.open !== "raise" &&
      stepForm(state.open, stored, state, send, onOpen),
    questions.length > 0 &&
      h(
        "ul",
        { class: "app-questions" },
        questions.map((q) =>
          h(
            "li",
            { key: q.id },
            `Open question from ${q.authorName}: ${q.body} `,
            h("button", {
              type: "button",
              class: "quiet",
              disabled: state.busy,
              onClick: () =>
                send(
                  { step: "resolveQuestion", id, questionId: q.id },
                  "Marked answered.",
                ),
            }, "Mark answered"),
          )
        ),
      ),
    allowed.includes("message") &&
      h(
        "form",
        {
          class: "app-form app-reply",
          onSubmit: (e: Event) => {
            e.preventDefault();
            const body = String(
              new FormData(e.currentTarget as HTMLFormElement).get("reply") ??
                "",
            ).trim();
            if (body) send({ step: "reply", id, body }, "Posted.");
          },
        },
        field(state, "reply", "Reply on the request"),
        h(
          "div",
          { class: "app-buttons" },
          h("button", { type: "submit", disabled: state.busy }, "Reply"),
        ),
      ),
    others.length > 0 &&
      h(
        "p",
        { class: "app-more" },
        "Also yours, from the command line: ",
        others.map((a) => STEPS[a][0]).join(", "),
        ".",
      ),
  );
}

/** The top of the page: who you are, and your steps. */
export function StepsPanel(props: {
  behavior: string;
  requests: Stored[];
  people: Person[];
  /** The request on screen, or null on the list. */
  current: Stored | null;
  acting: Acting;
  /** Who the picker says, when the app can't take steps. */
  picked: Person | null;
  onViewer: (email: string) => void;
  state: PanelState;
  send: Send;
  onOpen: (step: string | null) => void;
}) {
  const { behavior, requests, people, current, acting, state } = props;
  const signedIn = acting.kind === "signedIn" ? acting.person : null;
  // The people list's copy, so a change to it shows at once.
  const viewer = signedIn
    ? people.find((p) => p.userId === signedIn.userId) ?? null
    : acting.kind === "picker"
    ? props.picked
    : null;
  const who = acting.kind === "picker"
    ? h(
      "label",
      { class: "view-as" },
      "Viewing as ",
      h(
        "select",
        {
          value: viewer?.email ?? "",
          onChange: (e: Event) =>
            props.onViewer((e.currentTarget as HTMLSelectElement).value),
        },
        h("option", { value: "" }, "Choose who you are"),
        people.filter((p) => !p.standIn).map((p) =>
          h(
            "option",
            { key: p.email, value: p.email },
            `${p.name} (${p.email})`,
          )
        ),
      ),
      h(
        "span",
        { class: "view-as-note" },
        "Only to show your steps: steps are taken under swamp serve, signed in.",
      ),
    )
    : h(
      "p",
      { class: "view-as" },
      acting.kind === "checking"
        ? "Finding who you are…"
        : acting.kind === "refused"
        ? h("span", { role: "alert", class: "app-refused" }, acting.reason)
        : h(
          Fragment,
          null,
          "Signed in as ",
          h("strong", null, viewer?.name ?? signedIn!.name),
          ` (${viewer?.email ?? signedIn!.email})`,
          acting.kind === "signedIn" && !current &&
            h("button", {
              type: "button",
              class: "raise",
              disabled: state.busy,
              "aria-expanded": String(state.open === "raise"),
              onClick: () =>
                props.onOpen(state.open === "raise" ? null : "raise"),
            }, "Raise a request"),
        ),
    );
  const flash = state.flash &&
    h(
      "p",
      {
        class: state.flash.error ? "app-flash error" : "app-flash",
        role: state.flash.error ? "alert" : "status",
      },
      state.flash.text,
    );
  let steps = null;
  if (viewer && current) {
    steps = h(
      "div",
      { class: "my-steps" },
      h("h2", null, "Your steps"),
      signedIn
        ? actionsFor(current, viewer, state, props.send, props.onOpen)
        : stepsFor(current, viewer).length === 0
        ? h("p", { class: "empty" }, "Nothing for you to do on this request.")
        : h(
          "ul",
          null,
          stepsFor(current, viewer).map((a) =>
            h(
              "li",
              { key: a },
              h("strong", null, STEPS[a][0]),
              " ",
              h("code", null, stepCommand(behavior, current, viewer, a)),
            )
          ),
        ),
    );
  } else if (viewer) {
    const waiting = requests
      .map((s) => ({ s, moves: waitingSteps(s, viewer) }))
      .filter((w) => w.moves.length > 0)
      .sort((a, b) =>
        b.s.request.updatedAt.localeCompare(a.s.request.updatedAt)
      );
    steps = h(
      "div",
      { class: "my-steps" },
      signedIn && state.open === "raise" &&
        stepForm("raise", null, state, props.send, props.onOpen),
      h("h2", null, "Waiting on you"),
      waiting.length === 0
        ? h("p", { class: "empty" }, "Nothing is waiting on you.")
        : h(
          "ul",
          null,
          waiting.map((w) =>
            h(
              "li",
              { key: w.s.request.id },
              h("a", { href: href(w.s) }, label(w.s)),
              ": ",
              w.moves.map((a) => STEPS[a][0]).join(", "),
            )
          ),
        ),
    );
  }
  const changes = current ? [] : recentChanges(requests);
  return h(
    "section",
    { class: "app-panel", "aria-label": "Your steps" },
    who,
    flash,
    steps,
    changes.length > 0 &&
      h(
        "div",
        { class: "status-strip" },
        h("h2", null, "Recent changes"),
        h(
          "ul",
          null,
          changes.map((c) =>
            h(
              "li",
              {
                key: `${c.stored.request.id}@${c.at}`,
                class: c.failed ? "failed" : undefined,
              },
              h("a", { href: href(c.stored) }, label(c.stored)),
              h(Fragment, null, " · ", c.text, " · ", formatTime(c.at)),
            )
          ),
        ),
      ),
  );
}
