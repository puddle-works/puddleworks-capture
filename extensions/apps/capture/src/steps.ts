// What the Slack app tells people, shown in the Capture app: each person's
// steps on a request, as Capture's rules decide them (allowedActions), and the
// status changes Slack announces. The app is read-only, so a step is shown
// with the command that takes it, not as a button.
import { Fragment, h } from "preact";
import type { Stored } from "../../../models/_lib/capture/ports.ts";
import {
  type AllowedAction,
  allowedActions,
} from "../../../models/_lib/domain/allowed.ts";
import type { Person } from "../../../models/_lib/domain/model.ts";
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

/** The top of the page: who you are, and your steps. */
export function StepsPanel(props: {
  behavior: string;
  requests: Stored[];
  people: Person[];
  /** The request on screen, or null on the list. */
  current: Stored | null;
  viewer: Person | null;
  onViewer: (email: string) => void;
}) {
  const { behavior, requests, people, current, viewer } = props;
  const picker = h(
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
        h("option", { key: p.email, value: p.email }, `${p.name} (${p.email})`)
      ),
    ),
    h(
      "span",
      { class: "view-as-note" },
      "Only to show your steps; the app changes nothing.",
    ),
  );
  let steps = null;
  if (viewer && current) {
    const allowed = stepsFor(current, viewer);
    steps = h(
      "div",
      { class: "my-steps" },
      h("h2", null, "Your steps"),
      allowed.length === 0
        ? h("p", { class: "empty" }, "Nothing for you to do on this request.")
        : h(
          "ul",
          null,
          allowed.map((a) =>
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
      .map((s) => ({
        s,
        moves: waitingSteps(s, viewer),
      }))
      .filter((w) => w.moves.length > 0)
      .sort((a, b) =>
        b.s.request.updatedAt.localeCompare(a.s.request.updatedAt)
      );
    steps = h(
      "div",
      { class: "my-steps" },
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
    picker,
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
