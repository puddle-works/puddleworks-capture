// The requests behavior end to end against a fake swamp: arguments as the CLI
// sends them, data written by instance name, and errors in plain words.
import { describe, expect, it } from "./_lib/domain/test_bdd.ts";
import { goodSpec, releasingResult } from "./_lib/domain/test_fixtures.ts";
import { FakeSwamp } from "./_lib/capture/fake_swamp.ts";
import { model } from "./capture.ts";

type MethodName = keyof typeof model.methods;

function setup(globalArgs: Record<string, unknown> = {}) {
  const swamp = new FakeSwamp();
  const context = swamp.context(model.globalArguments.parse(globalArgs));
  async function run(method: MethodName, input: Record<string, unknown> = {}) {
    const m = model.methods[method];
    // deno-lint-ignore no-explicit-any
    const out = await (m.execute as any)(m.arguments.parse(input), context) as {
      dataHandles: { name: string }[];
    };
    swamp.checkHandles(out.dataHandles);
    return out;
  }
  return { swamp, run };
}

async function people(run: ReturnType<typeof setup>["run"]) {
  await run("add_person", { email: "olive@example.com", name: "Olive Owner" });
  await run("add_person", {
    email: "bea@example.com",
    name: "Bea Builder",
    builder: "true",
  });
}

describe("@puddleworks/capture/requests", () => {
  it("declares its type, and spec names swamp accepts", () => {
    expect(model.type).toBe("@puddleworks/capture/requests");
    for (const spec of Object.keys(model.resources)) {
      expect(spec.includes("-")).toBe(false);
    }
  });

  it("upgrades existing instances to its version, keeping their settings", () => {
    const last = model.upgrades.at(-1)!;
    expect(last.toVersion).toBe(model.version);
    const old = { appUrl: "http://127.0.0.1:3002", defaultAs: "a@example.com" };
    expect(last.upgradeAttributes(old)).toEqual(old);
  });

  it("links exported specs to the viewer's port when appUrl is left out", () => {
    expect(model.globalArguments.parse({}).appUrl).toBe(
      "http://127.0.0.1:3002",
    );
  });

  it("is at the version the manifest publishes", async () => {
    const manifest = await Deno.readTextFile(
      new URL("../../manifest.yaml", import.meta.url),
    );
    const published = manifest.match(/^version: "([^"]+)"$/m)?.[1];
    expect(model.version).toBe(published);
  });

  it("says who changed and their builder flag", async () => {
    const { swamp, run } = setup();
    await people(run);
    await run("update_person", {
      email: "bea@example.com",
      name: "Bea Baker",
      builder: "false",
    });
    expect(swamp.logs.at(-1)).toBe(
      "Updated Bea Baker <bea@example.com>; builder: false",
    );
  });

  it("says what each change did to the request", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    const created = await run("create_request", {
      title: "Stock counts",
      description: "",
    });
    const id = String(swamp.data(created.dataHandles[0].name)!.id);
    await run("submit", { id: "#1" });
    expect(swamp.logs.at(-1)).toBe(
      `Submitted request #1 (${id}): now discussing, version 2`,
    );
    await run("post_message", { id: "#1", body: "Which stockroom?" });
    expect(swamp.logs.at(-1)).toBe(
      `Posted a message on request #1 (${id}): now discussing, version 3`,
    );
  });

  it("writes a retried request once when it is numbered in the same run", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    const input = {
      title: "Stock counts",
      description: "",
      idempotencyKey: "k",
    };
    const first = await run("create_request", input);
    // As it was before numbering: the next write gives it its number.
    const name = first.dataHandles[0].name;
    swamp.written.findLast((r) => r.name === name)!.attributes.number = null;
    const before = swamp.written.filter((r) => r.name === name).length;
    const again = await run("create_request", input);
    const versions = swamp.written.filter((r) => r.name === name);
    expect(versions.length).toBe(before + 1);
    expect(versions.at(-1)!.attributes).toMatchObject({ number: 1 });
    expect(again.dataHandles).toHaveLength(1);
    expect(again.dataHandles[0]).toMatchObject({
      name,
      version: versions.at(-1)!.version,
    });
  });

  it("adds people, reading builder=false from the command line as false", async () => {
    const { swamp, run } = setup();
    const { dataHandles } = await run("add_person", {
      email: "cal@example.com",
      name: "Cal",
      builder: "false",
    });
    expect(swamp.data(dataHandles[0].name)).toMatchObject({
      email: "cal@example.com",
      isBuilder: false,
    });
  });

  it("logs a request as the defaultAs person, and gives the same one back for the same key", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    const input = {
      title: "Stock counts",
      description: "We count every Friday.",
      idempotencyKey: "turn-1",
    };
    const first = await run("create_request", input);
    const again = await run("create_request", input);
    expect(again.dataHandles.map((h) => h.name)).toEqual(
      first.dataHandles.map((h) => h.name),
    );
    const request = swamp.data(first.dataHandles[0].name)!;
    // The workflow's output is read as .id, as it was from the client.
    expect(first.dataHandles[0].name).toBe(`request-${request.id}`);
    expect(request).toMatchObject({
      title: "Stock counts",
      status: "draft",
      version: 1,
      number: 1,
    });
    expect(swamp.logs.at(-2)).toBe(
      `Logged request #1 (${request.id}): Stock counts`,
    );
    expect(swamp.logs.at(-1)).toBe(
      `Already logged as request #1 (${request.id}): Stock counts`,
    );
    // The retry hands back the same request, unchanged.
    const versions = swamp.written.filter((r) => r.specName === "request");
    expect(new Set(versions.map((r) => r.name)).size).toBe(1);
    expect(versions.at(-1)!.attributes).toEqual(versions[0].attributes);
  });

  it("logs a request for the person who asked, who then owns it and agrees it themselves", async () => {
    const { swamp, run } = setup({ defaultAs: "intake-bot@example.com" });
    await people(run);
    await run("add_person", {
      email: "intake-bot@example.com",
      name: "Intake bot",
    });
    const input = {
      title: "Stock counts",
      description: "We count every Friday.",
      idempotencyKey: "turn-7",
      requester: "olive@example.com",
    };

    // Someone not in the people list is refused, and nothing is logged.
    await expect.rejects(
      run("create_request", { ...input, requester: "nobody@example.com" }),
      expect.objectContaining({
        message: expect.stringContaining(
          "nobody@example.com isn't in Capture's people list",
        ),
      }),
    );
    expect(swamp.written.filter((r) => r.specName === "request")).toEqual([]);

    const first = await run("create_request", input);
    const again = await run("create_request", input);
    expect(again.dataHandles.map((h) => h.name)).toEqual(
      first.dataHandles.map((h) => h.name),
    );
    const logged = swamp.data(first.dataHandles[0].name)! as {
      id: string;
      outcomeOwnerId: string;
      loggedBy: unknown;
      participants: { email: string; role: string }[];
    };
    expect(logged.participants.map((p) => [p.email, p.role])).toEqual([
      ["olive@example.com", "outcome_owner"],
    ]);
    expect(logged.loggedBy).toMatchObject({
      email: "intake-bot@example.com",
      name: "Intake bot",
      sourceRef: "turn-7",
    });

    // The person who asked takes it through to agreement as themselves.
    const olive = { as: "olive@example.com", id: logged.id };
    const bea = { as: "bea@example.com", id: logged.id };
    await run("submit", olive);
    await run("join_request", bea);
    await run("edit_specification", { ...bea, specification: goodSpec });
    await run("propose", bea);
    await run("agree", { ...olive, version: "1" });
    await run("export_outcome_spec", olive);
    expect(swamp.data(`outcome-spec-${logged.id}`)).toMatchObject({
      agreement: { agreedBy: { email: "olive@example.com" } },
    });

    // Without requester the logging account owns it, as before.
    const own = await run("create_request", {
      title: "Another",
      description: "",
      idempotencyKey: "turn-8",
    });
    const bots = swamp.data(own.dataHandles[0].name)! as Record<
      string,
      unknown
    >;
    expect("loggedBy" in bots).toBe(false);
    expect(
      (bots.participants as { email: string; role: string }[]).map((p) => [
        p.email,
        p.role,
      ]),
    ).toEqual([["intake-bot@example.com", "outcome_owner"]]);

    // A request the bot already owns is handed to the person who asked.
    await run("transfer_ownership", {
      id: String(bots.id),
      to: "olive@example.com",
    });
    const handed = swamp.data(`request-${bots.id}`)! as {
      participants: { email: string; role: string }[];
      transitions: { action: string; note: string }[];
    };
    expect(handed.participants.map((p) => [p.email, p.role])).toEqual([
      ["olive@example.com", "outcome_owner"],
      ["intake-bot@example.com", "observer"],
    ]);
    expect(handed.transitions.map((t) => [t.action, t.note])).toEqual([
      [
        "transferOwnership",
        "Outcome owner changed from Intake bot to Olive Owner.",
      ],
    ]);
    await run("submit", { as: "olive@example.com", id: String(bots.id) });
    expect(swamp.data(`request-${bots.id}`)).toMatchObject({
      status: "discussing",
    });
  });

  it("logs a requested phrase into the draft spec's recipe", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    const created = await run("create_request", {
      title: "Count list",
      description: "Asked in chat.",
      phrase: "what needs counting this week",
      candidateExtensions: JSON.stringify(["@example/stock"]),
      idempotencyKey: "turn-2",
    });
    const request = swamp.data(created.dataHandles[0].name)!;
    expect(request).toMatchObject({
      requestedPhrase: "what needs counting this week",
      specifications: [{
        version: 1,
        status: "draft",
        content: {
          recipe: {
            examples: [{ phrase: "what needs counting this week", answer: "" }],
            candidateExtensions: ["@example/stock"],
          },
        },
      }],
    });
  });

  it("leaves the requested phrase out when it is blank, as the workflow sends it", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    const created = await run("create_request", {
      title: "Stock counts",
      description: "",
      phrase: "",
      candidateExtensions: [],
    });
    const request = swamp.data(created.dataHandles[0].name)!;
    expect("requestedPhrase" in request).toBe(false);
    expect(request.specifications).toEqual([]);
  });

  it("refuses to act without knowing who for", async () => {
    const { run } = setup();
    await people(run);
    await expect.rejects(
      run("create_request", { title: "Stock counts", description: "" }),
      expect.objectContaining({
        message: expect.stringContaining("defaultAs"),
      }),
    );
  });

  it("takes a request from draft to agreed, writing the outcome spec as it agrees", async () => {
    const { swamp, run } = setup({ appUrl: "http://capture.local:3001" });
    await people(run);
    const created = await run("create_request", {
      as: "olive@example.com",
      title: "Stock counts",
      description: "",
    });
    const id = String(swamp.data(created.dataHandles[0].name)!.id);
    const olive = { as: "olive@example.com", id };
    const bea = { as: "bea@example.com", id };
    await run("submit", olive);
    await run("join_request", bea);
    await run("edit_specification", {
      ...bea,
      specification: JSON.stringify(goodSpec),
    });
    await run("propose", bea);
    const agreed = await run("agree", { ...olive, version: "1" });
    expect(agreed.dataHandles.map((h) => h.name)).toEqual([
      `request-${id}`,
      `outcome-spec-${id}`,
    ]);
    const request = swamp.data(`request-${id}`)!;
    expect(request).toMatchObject({ status: "agreed", version: 6 });
    const doc = swamp.data(`outcome-spec-${id}`)!;
    expect(doc).toMatchObject({
      format: "puddleworks.dev/outcome-spec/v1",
      request: { url: `http://capture.local:3001/requests/${id}` },
      exportedAt: (request.agreements as { agreedAt: string }[])[0].agreedAt,
    });
    const exported = await run("export_outcome_spec", bea);
    expect(exported.dataHandles.map((h) => h.name)).toEqual([
      `request-${id}`,
      `outcome-spec-${id}`,
    ]);
    expect(swamp.data(`request-${id}`)).toMatchObject({
      status: "agreed",
      version: 7,
    });
    const md = await run("export_outcome_spec", { ...bea, format: "markdown" });
    expect(swamp.data(md.dataHandles[1].name)).toMatchObject({
      requestId: id,
      format: "markdown",
    });
  });

  it("acts on a request named by its number, and writes it under its id", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    const created = await run("create_request", {
      title: "Stock counts",
      description: "",
    });
    const id = String(swamp.data(created.dataHandles[0].name)!.id);
    const submitted = await run("submit", { id: "#1" });
    expect(submitted.dataHandles.map((h) => h.name)).toEqual([`request-${id}`]);
    expect(swamp.data(`request-${id}`)).toMatchObject({
      status: "discussing",
    });
    await run("get_request", { id: "1" });
    expect(swamp.data(`view-${id}`)).toMatchObject({ id, number: 1 });
    await run("join_request", { as: "bea@example.com", id: "#1" });
    await run("edit_specification", {
      as: "bea@example.com",
      id: "#1",
      specification: JSON.stringify(goodSpec),
    });
    await run("propose", { as: "bea@example.com", id: "#1" });
    await run("agree", { id: "#1", version: "1" });
    const exported = await run("export_outcome_spec", { id: "#1" });
    expect(exported.dataHandles.map((h) => h.name)).toEqual([
      `request-${id}`,
      `outcome-spec-${id}`,
    ]);
    const md = await run("export_outcome_spec", {
      id: "#1",
      format: "markdown",
    });
    expect(md.dataHandles[1].name).toBe(`outcome-spec-md-${id}`);
    expect(swamp.data(`outcome-spec-md-${id}`)).toMatchObject({
      requestId: id,
    });
  });

  it("reads a request an older Capture saved as exported as agreed", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    const created = await run("create_request", {
      title: "Stock counts",
      description: "",
    });
    const id = String(swamp.data(created.dataHandles[0].name)!.id);
    swamp.latest().find((r) => r.name === `request-${id}`)!.attributes
      .status = "exported";
    await run("get_request", { id });
    expect(swamp.data(`view-${id}`)).toMatchObject({ status: "agreed" });
  });

  it("reads one request and lists them as the person asking sees them", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    const created = await run("create_request", {
      title: "Stock counts",
      description: "",
    });
    const id = String(swamp.data(created.dataHandles[0].name)!.id);
    await run("get_request", { id });
    expect(swamp.data(`view-${id}`)).toMatchObject({
      id,
      yourRole: "outcome_owner",
      viewer: "olive@example.com",
    });
    await run("list_requests", { max: "10" });
    expect(swamp.data("requests-mine-all")).toMatchObject({
      scope: "mine",
      status: null,
      truncated: false,
    });
    expect((swamp.data("requests-mine-all")!.items as unknown[]).length).toBe(
      1,
    );
  });

  it("lets a reviewer ask for changes, and holds agree for open questions", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    await run("add_person", { email: "rae@example.com", name: "Rae Reviewer" });
    const created = await run("create_request", {
      title: "Stock counts",
      description: "",
    });
    const id = String(swamp.data(created.dataHandles[0].name)!.id);
    await run("submit", { id });
    await run("join_request", { as: "bea@example.com", id });
    await run("edit_specification", {
      as: "bea@example.com",
      id,
      specification: JSON.stringify(goodSpec),
    });
    await run("propose", { as: "bea@example.com", id });
    await run("invite", { id, email: "rae@example.com", role: "reviewer" });
    await run("post_message", {
      as: "rae@example.com",
      id,
      kind: "question",
      body: "What happens to a count entered twice?",
    });
    await expect.rejects(
      run("agree", { id, version: "1" }),
      expect.objectContaining({
        message: expect.stringContaining("Resolve the open question first."),
      }),
    );
    await run("request_changes", {
      as: "rae@example.com",
      id,
      note: "Say what a second count does",
    });
    expect(swamp.data(`request-${id}`)).toMatchObject({ status: "discussing" });
  });

  it("gives a reviewer the frozen spec to review, and records what they found", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    await run("add_person", { email: "rae@example.com", name: "Rae Reviewer" });
    const created = await run("create_request", {
      title: "Stock counts",
      description: "",
    });
    const id = String(swamp.data(created.dataHandles[0].name)!.id);
    const rae = { as: "rae@example.com", id: "#1" };
    await run("submit", { id });
    await run("join_request", { as: "bea@example.com", id });
    await run("edit_specification", {
      as: "bea@example.com",
      id,
      specification: JSON.stringify(goodSpec),
    });
    await run("invite", { id, email: "rae@example.com", role: "reviewer" });
    // Nothing to review until the spec is frozen for agreement.
    await expect.rejects(
      run("review_prompt", rae),
      expect.objectContaining({
        message: expect.stringContaining("ready for agreement"),
      }),
    );
    await run("propose", { as: "bea@example.com", id });
    const prompted = await run("review_prompt", rae);
    // Written under the request's id, for the workflow's next steps.
    expect(prompted.dataHandles.map((h) => h.name)).toEqual([
      `review-prompt-${id}`,
    ]);
    const prompt = swamp.data(`review-prompt-${id}`)!;
    expect(prompt).toMatchObject({ requestId: id, number: 1, version: 1 });
    expect(String(prompt.prompt)).toMatch(/AC1: A count can be entered/);

    // The agent's answer arrives as JSON text or as an object.
    await run("record_review", {
      ...rae,
      version: "1",
      review: JSON.stringify({
        verdict: "minor_revision",
        summary: "One gap.",
        findings: [{ id: "F1", text: "Who enters the count?" }],
      }),
    });
    expect(swamp.logs.at(-1)).toBe(
      `Recorded a review of request #1 (${id}): now ready_for_agreement, version 7`,
    );
    const after = swamp.data(`request-${id}`)! as {
      messages: { kind: string; body: string }[];
    };
    expect(after.messages.map((m) => [m.kind, m.body])).toEqual([
      ["question", "F1: Who enters the count?"],
      ["decision", "Review of version 1: minor revision. One gap."],
    ]);
    await expect.rejects(
      run("record_review", {
        as: "bea@example.com",
        id,
        review: { verdict: "ready", findings: [] },
      }),
      expect.objectContaining({
        message: expect.stringContaining("Only a reviewer"),
      }),
    );
    await run("record_review", {
      ...rae,
      review: { verdict: "not_safe", findings: [] },
    });
    expect(swamp.data(`request-${id}`)).toMatchObject({ status: "discussing" });
  });

  it("discusses, invites and removes", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    await run("add_person", { email: "cal@example.com", name: "Cal" });
    const created = await run("create_request", {
      title: "Stock counts",
      description: "",
    });
    const id = String(swamp.data(created.dataHandles[0].name)!.id);
    await run("submit", { id });
    await run("invite", { id, email: "cal@example.com", role: "observer" });
    await run("post_message", {
      id,
      kind: "question",
      body: "Which stockroom?",
    });
    const request = swamp.data(`request-${id}`)! as {
      messages: { id: string }[];
    };
    await run("resolve_question", { id, questionId: request.messages[0].id });
    await run("remove_participant", { id, email: "cal@example.com" });
    const after = swamp.data(`request-${id}`)! as {
      participants: unknown[];
      messages: { resolvedAt: unknown }[];
    };
    expect(after.participants).toHaveLength(1);
    expect(after.messages[0].resolvedAt === null).toBe(false);
  });

  it("records build results from a file or inline JSON, building then released", async () => {
    const dir = await Deno.makeTempDir();
    try {
      const swamp = new FakeSwamp();
      const context = swamp.context(model.globalArguments.parse({}), dir);
      const run = async (
        method: MethodName,
        input: Record<string, unknown> = {},
      ) => {
        const m = model.methods[method];
        // deno-lint-ignore no-explicit-any
        const out = await (m.execute as any)(m.arguments.parse(input), context);
        swamp.checkHandles(out.dataHandles);
        return out as { dataHandles: { name: string }[] };
      };
      await people(run);
      const created = await run("create_request", {
        as: "olive@example.com",
        title: "Stock counts",
        description: "",
      });
      const id = String(swamp.data(created.dataHandles[0].name)!.id);
      const olive = { as: "olive@example.com", id };
      const bea = { as: "bea@example.com", id };
      await run("submit", olive);
      await run("join_request", bea);
      await run("edit_specification", { ...bea, specification: goodSpec });
      await run("propose", bea);
      await run("agree", { ...olive, version: "1" });
      const agreed = swamp.data(`request-${id}`)!;
      const source = {
        url: `http://127.0.0.1:3002/requests/${id}`,
        version: 1,
        specHash: (agreed.agreements as { specHash: string }[])[0].specHash,
      };
      const building = releasingResult({ source, published: undefined });
      await Deno.writeTextFile(
        `${dir}/build-result.json`,
        JSON.stringify(building),
      );
      const first = await run("record_build_result", {
        as: "bea@example.com",
        result: "build-result.json",
      });
      expect(first.dataHandles.map((h) => h.name)).toEqual([`request-${id}`]);
      expect(swamp.data(`request-${id}`)).toMatchObject({ status: "building" });
      expect(swamp.logs.at(-1)).toBe(
        `Recorded a build result for request #1 (${id}): now building, version 7`,
      );
      await run("record_build_result", {
        as: "bea@example.com",
        result: JSON.stringify(releasingResult({ source })),
      });
      expect(swamp.data(`request-${id}`)).toMatchObject({
        status: "released",
        version: 8,
      });
      // The same result again changes nothing, but still hands back the request.
      const again = await run("record_build_result", {
        as: "bea@example.com",
        result: JSON.stringify(releasingResult({ source })),
      });
      expect(again.dataHandles.map((h) => h.name)).toEqual([`request-${id}`]);
      expect(swamp.data(`request-${id}`)).toMatchObject({ version: 8 });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("uploads an edited outcome-spec file with a reason, proposing the next version to agree", async () => {
    const dir = await Deno.makeTempDir();
    try {
      const swamp = new FakeSwamp();
      const context = swamp.context(model.globalArguments.parse({}), dir);
      const run = async (
        method: MethodName,
        input: Record<string, unknown> = {},
      ) => {
        const m = model.methods[method];
        // deno-lint-ignore no-explicit-any
        const out = await (m.execute as any)(m.arguments.parse(input), context);
        swamp.checkHandles(out.dataHandles);
        return out as { dataHandles: { name: string }[] };
      };
      await people(run);
      await run("add_person", { email: "cal@example.com", name: "Cal" });
      const created = await run("create_request", {
        as: "olive@example.com",
        title: "Stock counts",
        description: "",
      });
      const id = String(swamp.data(created.dataHandles[0].name)!.id);
      const olive = { as: "olive@example.com", id };
      const bea = { as: "bea@example.com", id };
      await run("submit", olive);
      await run("join_request", bea);
      await run("invite", {
        ...olive,
        email: "cal@example.com",
        role: "observer",
      });
      await run("edit_specification", { ...bea, specification: goodSpec });
      await run("propose", bea);
      await run("agree", { ...olive, version: "1" });
      const v1 = structuredClone(swamp.data(`outcome-spec-${id}`)!) as {
        request: { id: string };
        specification: { version: number; scope: { in: string[] } };
      };
      const edited = structuredClone(v1);
      edited.specification.scope.in.push("Counts from a second stockroom");
      await Deno.writeTextFile(`${dir}/v2.json`, JSON.stringify(edited));
      const reason = "The owner now has a second stockroom.";

      // An observer can't, and a file for another request is refused.
      await expect.rejects(
        run("revise_specification", {
          as: "cal@example.com",
          id,
          reason,
          outcomeSpec: "v2.json",
        }),
        expect.objectContaining({
          message: expect.stringContaining("(not_allowed)"),
        }),
      );
      await expect.rejects(
        run("revise_specification", {
          ...bea,
          reason,
          outcomeSpec: JSON.stringify({
            ...edited,
            request: { ...edited.request, id: "someone-else" },
          }),
        }),
        expect.objectContaining({
          message: expect.stringContaining("for request someone-else"),
        }),
      );
      // A spec that can't be proposed leaves the request as it was.
      const before = swamp.data(`request-${id}`)!;
      await expect.rejects(
        run("revise_specification", {
          ...bea,
          reason,
          basedOnVersion: "1",
          specification: { ...goodSpec, acceptanceCriteria: [] },
        }),
        expect.objectContaining({
          message: expect.stringContaining("isn't ready"),
        }),
      );
      expect(swamp.data(`request-${id}`)).toEqual(before);

      await run("revise_specification", {
        ...bea,
        reason,
        outcomeSpec: "v2.json",
      });
      const proposed = swamp.data(`request-${id}`)! as {
        status: string;
        specifications: {
          version: number;
          status: string;
          changeSummary?: string;
        }[];
      };
      expect(proposed.status).toBe("ready_for_agreement");
      expect(
        proposed.specifications.map((s) => [
          s.version,
          s.status,
          s.changeSummary,
        ]),
      ).toEqual([[1, "agreed", undefined], [2, "proposed", reason]]);

      // The same v1 file again is stale now that version 2 exists.
      await Deno.writeTextFile(`${dir}/v1.json`, JSON.stringify(v1));
      await expect.rejects(
        run("revise_specification", {
          ...bea,
          reason: "Again",
          outcomeSpec: "v1.json",
        }),
        expect.objectContaining({
          message: expect.stringContaining("version 2 is newer"),
        }),
      );

      await run("agree", { ...olive, version: "2" });
      expect(swamp.data(`outcome-spec-${id}`)).toMatchObject({
        specification: {
          version: 2,
          changeSummary: reason,
          scope: {
            in: [...goodSpec.scope.in, "Counts from a second stockroom"],
          },
        },
      });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("marks an agreed request building before any result, and only once", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    const created = await run("create_request", {
      title: "Stock counts",
      description: "",
    });
    const id = String(swamp.data(created.dataHandles[0].name)!.id);
    await run("submit", { id });
    await run("join_request", { as: "bea@example.com", id });
    await run("edit_specification", { id, specification: goodSpec });
    await run("propose", { id });
    const bea = { as: "bea@example.com", id };
    await expect.rejects(
      run("start_building", bea),
      expect.objectContaining({
        message: expect.stringContaining(
          "Can't start building a request that is ready for agreement; it must be agreed.",
        ),
      }),
    );
    await run("agree", { id, version: "1" });
    // The outcome owner asked for it; a builder does the building.
    await expect.rejects(
      run("start_building", { id }),
      expect.objectContaining({
        message: expect.stringContaining(
          "As the outcome owner you can't start building unless you are a builder in the people list.",
        ),
      }),
    );
    await run("start_building", bea);
    expect(swamp.data(`request-${id}`)).toMatchObject({ status: "building" });
    expect(swamp.logs.at(-1)).toBe(
      `Started building request #1 (${id}): now building, version 7`,
    );
    await expect.rejects(
      run("start_building", bea),
      expect.objectContaining({
        message: expect.stringContaining(
          "Can't start building a request that is building; it must be agreed.",
        ),
      }),
    );
    // A result for it afterwards keeps it building.
    const agreed = swamp.data(`request-${id}`)!;
    await run("record_build_result", {
      result: releasingResult({
        source: {
          url: `http://127.0.0.1:3002/requests/${id}`,
          version: 1,
          specHash: (agreed.agreements as { specHash: string }[])[0].specHash,
        },
        published: undefined,
      }),
    });
    expect(swamp.data(`request-${id}`)).toMatchObject({ status: "building" });
  });

  it("says why a published build isn't released yet", async () => {
    const { swamp, run } = setup({ defaultAs: "olive@example.com" });
    await people(run);
    const created = await run("create_request", {
      title: "Stock counts",
      description: "",
    });
    const id = String(swamp.data(created.dataHandles[0].name)!.id);
    await run("submit", { id });
    await run("edit_specification", { id, specification: goodSpec });
    await run("propose", { id });
    await run("agree", { id, version: "1" });
    const agreed = swamp.data(`request-${id}`)!;
    await run("record_build_result", {
      result: releasingResult({
        source: {
          url: `http://127.0.0.1:3002/requests/${id}`,
          version: 1,
          specHash: (agreed.agreements as { specHash: string }[])[0].specHash,
        },
        examples: [],
      }),
    });
    expect(swamp.logs.at(-1)).toBe(
      `Not released yet: The example "what should I order this week" wasn't reported.`,
    );
  });

  it("exports a snapshot file, and won't write over one", async () => {
    const dir = await Deno.makeTempDir();
    try {
      const swamp = new FakeSwamp();
      const context = swamp.context(model.globalArguments.parse({}), dir);
      const add = model.methods.add_person;
      await add.execute(
        add.arguments.parse({ email: "olive@example.com", name: "Olive" }),
        context,
      );
      const m = model.methods.export_snapshot;
      await m.execute(m.arguments.parse({ path: "snapshot.json" }), context);
      const file = `${dir}/snapshot.json`;
      expect(JSON.parse(await Deno.readTextFile(file))).toMatchObject({
        format: "capture-snapshot/v1",
        people: [{ email: "olive@example.com" }],
        requests: [],
      });
      // It holds people's emails, so only its owner can read it.
      expect((await Deno.stat(file)).mode! & 0o777).toBe(0o600);
      expect(swamp.data("export-latest")).toMatchObject({
        path: "snapshot.json",
        people: 1,
        requests: 0,
      });
      await expect.rejects(
        m.execute(m.arguments.parse({ path: "snapshot.json" }), context),
        expect.objectContaining({
          message: expect.stringContaining("already"),
        }),
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("imports a snapshot file from the repo once", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        `${dir}/snapshot.json`,
        JSON.stringify({
          format: "capture-snapshot/v1",
          exportedAt: "2026-10-27T09:00:00.000Z",
          people: [{
            userId: "u-1",
            name: "Olive",
            email: "olive@example.com",
            isBuilder: false,
          }],
          requests: [],
        }),
      );
      const swamp = new FakeSwamp();
      const context = swamp.context(model.globalArguments.parse({}), dir);
      const m = model.methods.import;
      await m.execute(m.arguments.parse({ path: "snapshot.json" }), context);
      await m.execute(m.arguments.parse({ path: "snapshot.json" }), context);
      expect(swamp.data("person-u-1")).toMatchObject({
        email: "olive@example.com",
      });
      expect(swamp.data("import-latest")).toMatchObject({
        peopleAdded: 0,
        peopleSkipped: 1,
        requestsNumbered: 0,
      });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
