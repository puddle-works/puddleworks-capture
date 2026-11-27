// The Capture app (extensions/apps/capture) only reads, and sends nothing
// anywhere: Capture holds people's emails. The dashboard lets an app fetch
// from any https site, so the app's own page policy and source must not.
import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  agreedRequest,
  owner,
  stranger,
  T2,
} from "../extensions/models/_lib/domain/test_fixtures.ts";
import {
  recentChanges,
  stepCommand,
  STEPS,
  stepsFor,
} from "../extensions/apps/capture/src/steps.ts";
import { model as requestsModel } from "../extensions/models/capture.ts";
import {
  followStep,
  type StepEvent,
} from "../extensions/apps/capture/src/step_events.ts";

const app = join(import.meta.dirname!, "../extensions/apps/capture");
const read = (path: string) =>
  Deno.readTextFileSync(path.startsWith("/") ? path : join(app, path));

// The app runs only the workflow that acts as the run's own login, never a
// method, which would let it say who acts with `as`.
Deno.test("the app reads data and runs only the step workflow", () => {
  const yaml = read("app.yaml");
  const field = (name: string) =>
    new RegExp(`^${name}:\\s*(.*)$`, "m").exec(yaml)?.[1]?.trim();
  assertEquals(field("capabilities"), "[data:read]");
  assertEquals(field("run"), '["@puddleworks/capture-app-step"]');
  assertEquals(field("methods"), "[]");
  const workflow = Deno.readTextFileSync(
    join(app, "../../../workflows/workflow-capture-app-step.yaml"),
  );
  assert(workflow.includes("principal: ${{ run.initiatedBy }}"));
  // A stand-in's turn runs only when Capture says one is due.
  assert(workflow.includes("guard: ${{ !steps.next.outputs.due }}"));
  assert(
    workflow.includes('workflowIdOrName: "@puddleworks/capture-stand-in"'),
  );
  assert(!/^\s+(as|principal):\s*$/m.test(workflow.split("jobs:")[0]));
});

Deno.test("the app's page lets it connect to and load from no site", () => {
  const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/
    .exec(read("index.html"))?.[1] ?? "";
  const directives = new Map(
    policy.split(";").map((d) => d.trim().split(/\s+/)).map((
      [name, ...sources],
    ) => [name, sources.join(" ")]),
  );
  assertEquals(directives.get("connect-src"), "'none'");
  assertEquals(directives.get("img-src"), "data:");
});

// The policy can't stop navigation: swamp lets an app open a tab outside its
// sandbox, so code that opens one or moves a window could carry data in the
// address. Links a person follows are the page's own. Allowed addresses:
// namespaces and schema ids, the registry link the page shows for a build,
// and zod's IPv6 check, which parses `http://[...]` without loading it.
const egress =
  /\bfetch\s*\(|WebSocket|XMLHttpRequest|EventSource|sendBeacon|new\s+Image\b|\bwindow\.open\b|\bopen\s*\(|\blocation\b|https?:\/\/(?!(www\.)?(w3\.org|json-schema\.org)\/|swamp-club\.com\/extensions\/|\[)/;

/** The app's source and every module it reaches by relative import. */
function bundled(): string[] {
  const queue = [...Deno.readDirSync(join(app, "src"))]
    .filter((e) => e.isFile && /\.tsx?$/.test(e.name))
    .map((e) => join(app, "src", e.name));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, spec] of read(file).matchAll(/from\s+"(\.[^"]+)"/g)) {
      if (/\.tsx?$/.test(spec)) queue.push(join(dirname(file), spec));
    }
  }
  return [...seen];
}

Deno.test("the app's code calls no site and navigates nowhere", () => {
  const files = bundled();
  // Its source, the shared page and the domain rules it renders with.
  assert(files.some((f) => f.endsWith("_lib/web/page/view.ts")));
  assert(files.some((f) => f.includes("_lib/domain/")));
  const hits = files.filter((file) => {
    // Comments may name a site; code may not.
    const code = read(file).replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    return egress.test(code);
  });
  assertEquals(hits, []);
});

Deno.test("the built app calls no site and navigates nowhere", () => {
  const assets = join(app, "dist/assets");
  let built: string[];
  try {
    built = [...Deno.readDirSync(assets)].filter((e) => e.name.endsWith(".js"))
      .map((e) => join(assets, e.name));
  } catch {
    return; // Not built here; swamp app build makes dist/ before a push.
  }
  assertEquals(built.filter((file) => egress.test(read(file))), []);
});

// What Slack announces, shown in the app as Recent changes, and each person's
// steps as Capture's rules give them.
Deno.test("recent changes are announced moves and failed router tests", () => {
  const request = agreedRequest();
  request.transitions.push(
    // Not a move, so not announced.
    { ...request.transitions.at(-1)!, from: "agreed", to: "agreed" },
  );
  request.routerTests = [{
    version: "2026.10.23.1",
    results: [
      { phrase: "what needs counting", outcome: "not-answered", note: null },
    ],
    recordedBy: owner.userId,
    recordedAt: "2026-10-23T12:00:00.000Z",
  }];
  const stored = {
    request,
    version: 1,
    idempotencyKeys: [],
    before: null,
    legacy: null,
    number: 7,
  };
  assertEquals(
    recentChanges([stored]).map((c) => [c.at, c.text]),
    [
      [
        "2026-10-23T12:00:00.000Z",
        "Router test of 2026.10.23.1 failed: “what needs counting” wasn't answered",
      ],
      [T2, "Agreed (version 1)"],
    ],
  );
  assertEquals(
    stepCommand("capture", stored, owner, "export"),
    `swamp behavior run capture export_outcome_spec --input id=7 --input as=${owner.email}`,
  );
  assert(stepsFor(stored, owner).includes("export"));
  assertEquals(stepsFor(stored, stranger), []);
});

Deno.test("each step names a method of the requests behavior", () => {
  const methods = Object.keys(requestsModel.methods);
  const missing = Object.values(STEPS).map(([, method]) => method)
    .filter((m) => !methods.includes(m));
  assertEquals(missing, []);
});

Deno.test("a step's command quotes an email the shell would break on", () => {
  const stored = {
    request: agreedRequest(),
    version: 1,
    idempotencyKeys: [],
    before: null,
    legacy: null,
    number: 7,
  };
  assertEquals(
    stepCommand(
      "capture",
      stored,
      { ...owner, email: "o'brien@example.com" },
      "export",
    ),
    `swamp behavior run capture export_outcome_spec --input id=7 --input 'as=o'\\''brien@example.com'`,
  );
});

// A step's outcome, from its run's events. A stand-in's turn may follow in
// the same run, so the step is done once Capture has said whether one
// follows, and the app never waits for the turn.
Deno.test("a step is done once taken, before any stand-in's turn", async () => {
  async function* events(list: StepEvent[], thenHang = false) {
    yield* list;
    if (thenHang) await new Promise(() => {});
  }
  const started: StepEvent = { kind: "started", runId: "r1" };
  // The run goes on into the agent's turn; the app stops following.
  assertEquals(
    await followStep(events([
      started,
      { kind: "step_completed", stepId: "step" },
      { kind: "step_completed", stepId: "next" },
    ], true)),
    { ok: true, runId: "r1" },
  );
  // Capture's refusal of the step is what the app says.
  assertEquals(
    await followStep(events([
      started,
      { kind: "step_failed", stepId: "step", error: "Refused (not_allowed)" },
    ], true)),
    { ok: false, error: "Refused (not_allowed)" },
  );
  // The step was taken even when deciding on a stand-in fails.
  assertEquals(
    await followStep(events([
      started,
      { kind: "step_completed", stepId: "step" },
      { kind: "step_failed", stepId: "next", error: "boom" },
    ], true)),
    { ok: true, runId: "r1" },
  );
  // A nested run's events aren't the step's.
  assertEquals(
    await followStep(events([
      started,
      { kind: "started", runId: "child", parentRunId: "r1" },
      { kind: "step_failed", stepId: "prompt", error: "no turn" },
      { kind: "completed", run: { id: "r1", status: "failed", jobs: [] } },
    ])),
    { ok: false, error: "The step failed." },
  );
});
