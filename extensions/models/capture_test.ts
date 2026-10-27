// The requests behavior end to end against a fake swamp: arguments as the CLI
// sends them, data written by instance name, and errors in plain words.
import { describe, expect, it } from "./_lib/domain/test_bdd.ts";
import { goodSpec } from "./_lib/domain/test_fixtures.ts";
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

  it("takes a request from draft to an exported outcome spec", async () => {
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
    await run("agree", { ...olive, version: "1" });
    const exported = await run("export_outcome_spec", bea);
    const doc = swamp.data(`outcome-spec-${id}`)!;
    expect(exported.dataHandles.map((h) => h.name)).toEqual([
      `request-${id}`,
      `outcome-spec-${id}`,
    ]);
    expect(doc).toMatchObject({
      format: "puddleworks.dev/outcome-spec/v1",
      request: { url: `http://capture.local:3001/requests/${id}` },
    });
    expect(swamp.data(`request-${id}`)).toMatchObject({
      status: "exported",
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
