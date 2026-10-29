// The use cases against an in-memory store: who may do what, by email, and
// what each one saves.
import { describe, expect, it } from "../domain/test_bdd.ts";
import { DomainError } from "../domain/index.ts";
import { goodSpec, releasingResult } from "../domain/test_fixtures.ts";
import { MemoryStore } from "./memory_store.ts";
import { createServices } from "./services.ts";
import type { Snapshot } from "./snapshot.ts";

const OLIVE = "olive@example.com";
const BEA = "bea@example.com";
const CAL = "cal@example.com";

async function setup() {
  const store = new MemoryStore();
  let n = 0;
  const services = createServices({
    store,
    clock: () => "2026-10-22T09:00:00.000Z",
    newId: () => `id-${++n}`,
    appUrl: "http://127.0.0.1:3002",
  });
  await services.addPerson({
    email: OLIVE,
    name: "Olive Owner",
    builder: false,
  });
  await services.addPerson({ email: BEA, name: "Bea Builder", builder: true });
  await services.addPerson({
    email: CAL,
    name: "Cal Colleague",
    builder: false,
  });
  return { store, services };
}

const draft = {
  title: "Stock counts",
  initialDescription: "We count stock every Friday.",
};

describe("people", () => {
  it("keeps emails in lower case and refuses a second person with the same one", async () => {
    const { services } = await setup();
    const person = await services.addPerson({
      email: "Dan@Example.com",
      name: "Dan",
      builder: false,
    });
    expect(person.email).toBe("dan@example.com");
    await expect.rejects(
      services.addPerson({
        email: "dan@example.com",
        name: "Dan again",
        builder: false,
      }),
      DomainError,
    );
  });

  it("changes a person's name and whether they build", async () => {
    const { services } = await setup();
    const person = await services.updatePerson({ email: CAL, builder: true });
    expect(person).toMatchObject({ name: "Cal Colleague", isBuilder: true });
  });

  it("refuses someone who isn't in the people list, and says how to add them", async () => {
    const { services } = await setup();
    await expect.rejects(
      services.create("nobody@example.com", draft),
      expect.objectContaining({
        code: "not_found",
        message: expect.stringContaining("add_person"),
      }),
    );
  });
});

describe("requests", () => {
  it("creates a draft owned by the person named", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    expect(stored.request).toMatchObject({
      status: "draft",
      title: "Stock counts",
    });
    expect(stored.request.participants[0]).toMatchObject({
      email: OLIVE,
      role: "outcome_owner",
    });
    expect(stored.version).toBe(1);
  });

  it("gives back the same request for the same idempotency key, without saving again", async () => {
    const { store, services } = await setup();
    const first = await services.create(OLIVE, draft, "turn-1");
    const saves = store.saves;
    const again = await services.create(
      OLIVE,
      { ...draft, title: "Different" },
      "turn-1",
    );
    expect(again.created).toBe(false);
    expect(again.stored.request.id).toBe(first.stored.request.id);
    expect(store.saves).toBe(saves);
    // Another person's key is their own.
    const theirs = await services.create(CAL, draft, "turn-1");
    expect(theirs.stored.request.id === first.stored.request.id).toBe(false);
  });

  it("hides a request from someone who isn't on it", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    await expect.rejects(
      services.get(CAL, stored.request.id),
      expect.objectContaining({ code: "not_found" }),
    );
  });

  it("lists mine, and the open ones a builder could join", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    await services.create(OLIVE, { ...draft, title: "Rota" });
    expect((await services.list(OLIVE, { scope: "mine", max: 10 })).items)
      .toHaveLength(2);
    expect((await services.list(BEA, { scope: "available", max: 10 })).items)
      .toHaveLength(0);
    await services.submit(OLIVE, stored.request.id);
    const available = await services.list(BEA, { scope: "available", max: 10 });
    expect(available.items.map((s) => s.request.id)).toEqual([
      stored.request.id,
    ]);
    const truncated = await services.list(OLIVE, { scope: "mine", max: 1 });
    expect(truncated).toMatchObject({ truncated: true });
    await expect.rejects(
      services.list(CAL, { scope: "available", max: 10 }),
      expect.objectContaining({ code: "not_allowed" }),
    );
  });

  it("filters a list by status", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    await services.create(OLIVE, { ...draft, title: "Rota" });
    await services.submit(OLIVE, stored.request.id);
    const discussing = await services.list(OLIVE, {
      scope: "mine",
      status: "discussing",
      max: 10,
    });
    expect(discussing.items.map((s) => s.request.id)).toEqual([
      stored.request.id,
    ]);
  });

  it("goes from draft to agreed, and agreeing gives the outcome spec export gives", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    const id = stored.request.id;
    await services.submit(OLIVE, id);
    await services.join(BEA, id);
    await services.editSpecification(BEA, id, {
      content: goodSpec,
      basedOnMessageIds: [],
    }, null);
    await services.propose(BEA, id);
    const agreed = await services.agree(OLIVE, id, 1);
    expect(agreed.stored.request.status).toBe("agreed");
    const agreement = agreed.stored.request.agreements[0];
    expect(agreement.specHash).toMatch(/^[0-9a-f]{64}$/);
    expect(agreed.document).toMatchObject({
      format: "puddleworks.dev/outcome-spec/v1",
      request: { id, url: `http://127.0.0.1:3002/requests/${id}` },
      exportedAt: agreement.agreedAt,
    });
    const { stored: exported, document } = await services.export(
      BEA,
      id,
      "outcome-spec/v1+json",
    );
    expect(exported.request.status).toBe("agreed");
    expect(exported.request.exports).toHaveLength(1);
    expect(document).toEqual(agreed.document);
    const markdown = await services.export(BEA, id, "markdown");
    expect(typeof markdown.document).toBe("string");
  });

  it("counts each saved change as a new version", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    const submitted = await services.submit(OLIVE, stored.request.id);
    expect(submitted.version).toBe(2);
  });

  it("refuses a specification edit made against an older one", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    const id = stored.request.id;
    await services.submit(OLIVE, id);
    await services.join(BEA, id);
    await services.editSpecification(BEA, id, {
      content: goodSpec,
      basedOnMessageIds: [],
    }, '"none"');
    await expect.rejects(
      services.editSpecification(BEA, id, {
        content: goodSpec,
        basedOnMessageIds: [],
      }, '"none"'),
      expect.objectContaining({
        code: "invalid_state",
        message: expect.stringContaining("has changed"),
      }),
    );
  });

  it("invites by email and removes by email", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    const id = stored.request.id;
    await services.submit(OLIVE, id);
    const { participant } = await services.invite(OLIVE, id, {
      email: "CAL@example.com",
      role: "observer",
    });
    expect(participant).toMatchObject({ email: CAL, role: "observer" });
    expect((await services.get(CAL, id)).request.id).toBe(id);
    await services.removeParticipant(OLIVE, id, CAL);
    await expect.rejects(
      services.get(CAL, id),
      expect.objectContaining({ code: "not_found" }),
    );
    await expect.rejects(
      services.invite(OLIVE, id, {
        email: "nobody@example.com",
        role: "observer",
      }),
      expect.objectContaining({
        code: "not_found",
        message: expect.stringContaining("add_person"),
      }),
    );
  });

  it("posts a question and resolves it", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    const id = stored.request.id;
    await services.submit(OLIVE, id);
    const { message } = await services.postMessage(OLIVE, id, {
      kind: "question",
      body: "Which stockroom?",
    });
    const { message: resolved } = await services.resolveQuestion(
      OLIVE,
      id,
      message.id,
      null,
    );
    expect(resolved.resolvedAt).toBe("2026-10-22T09:00:00.000Z");
  });
});

describe("numbers", () => {
  it("numbers requests 1, 2, 3 in the order they are made", async () => {
    const { services } = await setup();
    const made = [];
    for (const title of ["One", "Two", "Three"]) {
      made.push((await services.create(OLIVE, { ...draft, title })).stored);
    }
    expect(made.map((s) => s.number)).toEqual([1, 2, 3]);
    // A retry is the same request, so it keeps its number.
    const first = await services.create(OLIVE, draft, "turn-1");
    const again = await services.create(OLIVE, draft, "turn-1");
    expect([first.stored.number, again.stored.number]).toEqual([4, 4]);
  });

  it("finds a request by its number, with or without #", async () => {
    const { services } = await setup();
    await services.create(OLIVE, draft);
    const { stored } = await services.create(OLIVE, {
      ...draft,
      title: "Rota",
    });
    expect((await services.get(OLIVE, "2")).request.id).toBe(stored.request.id);
    expect((await services.get(OLIVE, "#2")).request.id).toBe(
      stored.request.id,
    );
    const submitted = await services.submit(OLIVE, "#2");
    expect(submitted.request).toMatchObject({
      id: stored.request.id,
      status: "discussing",
    });
    await expect.rejects(
      services.get(OLIVE, "#3"),
      expect.objectContaining({ code: "not_found" }),
    );
    // Someone not on it can't learn which number it has.
    await expect.rejects(
      services.get(CAL, "#2"),
      expect.objectContaining({ code: "not_found" }),
    );
  });

  it("links an outcome spec asked for by number to the request's page by id", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    const id = stored.request.id;
    await services.submit(OLIVE, "#1");
    await services.join(BEA, "#1");
    await services.editSpecification(BEA, "#1", {
      content: goodSpec,
      basedOnMessageIds: [],
    }, null);
    await services.propose(BEA, "#1");
    await services.agree(OLIVE, "#1", 1);
    const { document } = await services.export(
      BEA,
      "#1",
      "outcome-spec/v1+json",
    );
    expect(document).toMatchObject({
      request: { id, url: `http://127.0.0.1:3002/requests/${id}` },
    });
  });

  it("numbers requests saved before numbers, oldest first, when the next one is made", async () => {
    const { store, services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    for (const [id, at] of [["r-new", "2026-10-21"], ["r-old", "2026-10-20"]]) {
      store.requests.set(id, {
        ...stored,
        request: { ...stored.request, id, createdAt: `${at}T09:00:00.000Z` },
        number: null,
      });
    }
    const next = await services.create(OLIVE, { ...draft, title: "Rota" });
    expect(next.stored.number).toBe(4);
    expect(store.requests.get("r-old")!.number).toBe(2);
    expect(store.requests.get("r-new")!.number).toBe(3);
    // Numbering isn't a change to the request.
    expect(store.requests.get("r-old")!.version).toBe(1);
  });
});

describe("import", () => {
  const snapshot: Snapshot = {
    format: "capture-snapshot/v1",
    exportedAt: "2026-10-27T09:00:00.000Z",
    people: [
      {
        userId: "u-old",
        name: "Old Owner",
        email: "old@example.com",
        isBuilder: false,
      },
      // Already here under another id: kept as it is.
      { userId: "u-dup", name: "Bea B", email: BEA, isBuilder: true },
    ],
    requests: [],
  };

  it("brings in people and requests once, however often it runs", async () => {
    const { services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    const withRequest: Snapshot = {
      ...snapshot,
      requests: [{
        request: { ...stored.request, id: "r-old" },
        version: 4,
        idempotencyKeys: [{ userId: "id-1", key: "k" }],
        before: { name: "Old name", state: "triaged", transitions: [] },
        legacy: { source: "puddleworks" },
      }],
    };
    const first = await services.importSnapshot(withRequest);
    expect(first).toEqual({
      peopleAdded: 1,
      peopleSkipped: 1,
      requestsAdded: 1,
      requestsSkipped: 0,
      requestsNumbered: 1,
    });
    const again = await services.importSnapshot(withRequest);
    expect(again).toEqual({
      peopleAdded: 0,
      peopleSkipped: 2,
      requestsAdded: 0,
      requestsSkipped: 1,
      requestsNumbered: 0,
    });
    const imported = await services.get(OLIVE, "r-old");
    expect(imported).toMatchObject({
      version: 4,
      before: { name: "Old name" },
      number: 2,
    });
  });

  it("numbers what it brings in, oldest first, after the requests already here", async () => {
    const { store, services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    const old = (id: string, at: string) => ({
      request: { ...stored.request, id, createdAt: `${at}T09:00:00.000Z` },
      version: 1,
      idempotencyKeys: [],
      before: null,
      legacy: null,
    });
    const saves = store.saves;
    await services.importSnapshot({
      ...snapshot,
      requests: [old("r-b", "2026-10-02"), old("r-a", "2026-10-01")],
    });
    // Each saved once, already numbered, so swamp's latest is the only one.
    expect(store.saves - saves).toBe(2);
    expect((await services.get(OLIVE, "r-a")).number).toBe(2);
    expect((await services.get(OLIVE, "r-b")).number).toBe(3);
  });

  it("keeps a snapshot's numbers, and gives the next free one where a number is taken", async () => {
    const { store, services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    const numbered = (id: string, number: number, at: string) => ({
      request: { ...stored.request, id, createdAt: `${at}T09:00:00.000Z` },
      version: 1,
      idempotencyKeys: [],
      before: null,
      legacy: null,
      number,
    });
    const counts = await services.importSnapshot({
      ...snapshot,
      requests: [
        numbered("r-one", 1, "2026-10-01"),
        numbered("r-five", 5, "2026-10-02"),
        numbered("r-five-too", 5, "2026-10-03"),
      ],
    });
    expect(counts.requestsNumbered).toBe(2);
    expect(store.requests.get("r-five")!.number).toBe(5);
    expect(store.requests.get("r-one")!.number).toBe(6);
    expect(store.requests.get("r-five-too")!.number).toBe(7);
  });

  it("refuses a file that isn't a Capture snapshot", async () => {
    const { services } = await setup();
    await expect.rejects(
      services.importSnapshot(
        { format: "something-else" } as unknown as Snapshot,
      ),
      expect.objectContaining({ code: "invalid_input" }),
    );
  });
});

describe("export", () => {
  it("brings a request saved as exported in as agreed", async () => {
    const from = await setup();
    const { stored } = await from.services.create(OLIVE, draft);
    const snapshot = JSON.parse(
      JSON.stringify(await from.services.exportSnapshot()),
    ) as Snapshot;
    const old = snapshot.requests[0].request as unknown as Record<
      string,
      unknown
    >;
    old.status = "exported";
    const to = empty();
    await to.services.importSnapshot(snapshot);
    expect(to.store.requests.get(stored.request.id)?.request.status).toBe(
      "agreed",
    );
  });

  function empty() {
    const store = new MemoryStore();
    let n = 0;
    const services = createServices({
      store,
      clock: () => "2026-10-28T09:00:00.000Z",
      newId: () => `new-${++n}`,
      appUrl: "http://127.0.0.1:3002",
    });
    return { store, services };
  }
  const byKey = <T>(map: Map<string, T>) => Object.fromEntries(map);

  it("holds everything, so an import into an empty store gives the same record", async () => {
    const from = await setup();
    const { stored } = await from.services.create(OLIVE, draft, "turn-1");
    await from.services.submit(OLIVE, stored.request.id);
    await from.services.create(BEA, { ...draft, title: "Rota" });
    const snapshot = await from.services.exportSnapshot();
    expect(snapshot).toMatchObject({
      format: "capture-snapshot/v1",
      exportedAt: "2026-10-22T09:00:00.000Z",
    });
    // It goes through a file, so only what survives JSON counts.
    const file = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
    const to = empty();
    expect(await to.services.importSnapshot(file)).toEqual({
      peopleAdded: 3,
      peopleSkipped: 0,
      requestsAdded: 2,
      requestsSkipped: 0,
      requestsNumbered: 0,
    });
    expect(byKey(to.store.people)).toEqual(byKey(from.store.people));
    expect(byKey(to.store.requests)).toEqual(byKey(from.store.requests));
    expect(await to.services.importSnapshot(file)).toMatchObject({
      peopleAdded: 0,
      requestsAdded: 0,
    });
  });

  it("gives back the same request for a key logged before the move", async () => {
    const from = await setup();
    const { stored } = await from.services.create(OLIVE, draft, "turn-1");
    const to = empty();
    await to.services.importSnapshot(await from.services.exportSnapshot());
    const again = await to.services.create(OLIVE, draft, "turn-1");
    expect(again.created).toBe(false);
    expect(again.stored.request.id).toBe(stored.request.id);
    expect(again.stored.number).toBe(1);
  });
});

describe("build results", () => {
  async function agreed() {
    const { store, services } = await setup();
    const { stored } = await services.create(OLIVE, draft);
    const id = stored.request.id;
    await services.submit(OLIVE, id);
    await services.join(BEA, id);
    await services.editSpecification(BEA, id, {
      content: goodSpec,
      basedOnMessageIds: [],
    }, null);
    await services.propose(BEA, id);
    const { stored: done } = await services.agree(OLIVE, id, 1);
    const result = releasingResult({
      source: {
        url: `http://127.0.0.1:3002/requests/${id}`,
        version: 1,
        specHash: done.request.agreements[0].specHash,
      },
    });
    return { store, services, id, result };
  }

  it("records a result against the request its source names, and releases it", async () => {
    const { services, id, result } = await agreed();
    const stored = await services.recordBuildResult(BEA, result);
    expect(stored.request.id).toBe(id);
    expect(stored.request.status).toBe("released");
    expect(stored.request.buildResults[0].result).toEqual(result);
  });

  it("saves nothing when the same result is recorded again", async () => {
    const { store, services, result } = await agreed();
    await services.recordBuildResult(BEA, result);
    const saves = store.saves;
    const again = await services.recordBuildResult(BEA, result);
    expect(store.saves).toBe(saves);
    expect(again.request.buildResults).toHaveLength(1);
  });

  it("refuses a result that isn't a build-result/v1, saying what is wrong", async () => {
    const { services } = await agreed();
    await expect.rejects(
      services.recordBuildResult(BEA, { apiVersion: "x" }),
      expect.objectContaining({
        code: "invalid_input",
        message: expect.stringContaining(
          'That isn\'t a build-result/v1: apiVersion must be "puddleworks.dev/build-result/v1".',
        ),
      }),
    );
  });

  it("refuses a result with no source, or one for another Capture", async () => {
    const { services, result } = await agreed();
    const { source: _, ...noSource } = result;
    await expect.rejects(
      services.recordBuildResult(BEA, noSource),
      expect.objectContaining({
        code: "invalid_input",
        message:
          "The build result has no source, so Capture can't tell which request it was built for.",
      }),
    );
    await expect.rejects(
      services.recordBuildResult(BEA, {
        ...result,
        source: { ...result.source, url: "https://elsewhere.example/r/1" },
      }),
      expect.objectContaining({
        code: "invalid_input",
        message:
          "The build result is for https://elsewhere.example/r/1, which isn't a request here: requests here are at http://127.0.0.1:3002/requests/<id>.",
      }),
    );
  });

  it("answers a request someone can't see as missing", async () => {
    const { services, result } = await agreed();
    await expect.rejects(
      services.recordBuildResult(CAL, result),
      expect.objectContaining({ code: "not_found" }),
    );
  });

  it("keeps the build results through a snapshot", async () => {
    const { services, id, result } = await agreed();
    await services.recordBuildResult(BEA, result);
    const file = JSON.parse(
      JSON.stringify(await services.exportSnapshot()),
    ) as Snapshot;
    const store = new MemoryStore();
    const to = createServices({
      store,
      clock: () => "2026-10-28T09:00:00.000Z",
      newId: () => "new",
      appUrl: "http://127.0.0.1:3002",
    });
    await to.importSnapshot(file);
    expect(store.requests.get(id)?.request).toMatchObject({
      status: "released",
      buildResults: [{ result }],
    });
  });
});
