// The viewer's copy of Capture's data, read with swamp's data query.
import { describe, expect, it } from "../domain/test_bdd.ts";
import { agreedRequest, owner } from "../domain/test_fixtures.ts";
import { toResource } from "../capture/swamp_store.ts";
import { captureSource, predicate } from "./source.ts";

function records(version: number, extra: Record<string, unknown> = {}) {
  return {
    request: [{
      modelName: "capture",
      name: "request-r-1",
      version,
      attributes: {
        ...toResource({
          request: agreedRequest(),
          version,
          idempotencyKeys: [],
          before: null,
          legacy: null,
          number: 7,
        }),
        ...extra,
      },
    }],
    person: [{
      modelName: "capture",
      name: `person-${owner.userId}`,
      version: 1,
      content: JSON.stringify(owner),
    }],
  };
}

function fakeQuery(current: () => ReturnType<typeof records>) {
  const asked: string[] = [];
  const query = (p: string) => {
    asked.push(p);
    return Promise.resolve(
      p.includes(`"request"`) ? current().request : current().person,
    );
  };
  return { asked, query };
}

describe("capture source", () => {
  it("asks for one behavior's requests and people", () => {
    expect(predicate("capture", "request")).toBe(
      `modelType == "@puddleworks/capture/requests" && modelName == "capture" && specName == "request"`,
    );
    expect(() => predicate(`x" || true || "`, "request")).toThrowError();
  });

  it("lists the requests newest first and the people by name", async () => {
    const { query } = fakeQuery(() => records(3));
    const source = captureSource(query, "capture");
    await source.refresh();
    const overview = source.overview();
    expect(overview.requests.map((r) => r.id)).toEqual(["r-1"]);
    expect(overview.people).toEqual([{
      name: owner.name,
      email: owner.email,
      isBuilder: false,
    }]);
    expect(source.request("r-1")?.title).toBe("Stock counts");
    expect(source.request("nope")).toBe(undefined);
  });

  it("finds a request by its number too, so /requests/7 opens it", async () => {
    const { query } = fakeQuery(() => records(3));
    const source = captureSource(query, "capture");
    await source.refresh();
    expect(source.overview().requests[0].number).toBe(7);
    expect(source.request("7")?.id).toBe("r-1");
    expect(source.request("#7")?.id).toBe("r-1");
    expect(source.request("8")).toBe(undefined);
  });

  it("reads a request saved before numbers as having none", async () => {
    const { query } = fakeQuery(() => {
      const r = records(3);
      delete (r.request[0].attributes as Record<string, unknown>).number;
      return r;
    });
    const source = captureSource(query, "capture");
    await source.refresh();
    expect(source.request("r-1")?.number).toBe(null);
  });

  it("says whether anything changed since the last read", async () => {
    let version = 3;
    const { query } = fakeQuery(() => records(version));
    const source = captureSource(query, "capture");
    expect(await source.refresh()).toBe(true);
    expect(await source.refresh()).toBe(false);
    version = 4;
    expect(await source.refresh()).toBe(true);
  });

  it("skips a record it can't read rather than failing the page", async () => {
    const { query } = fakeQuery(() =>
      ({
        ...records(1),
        request: [{
          modelName: "capture",
          name: "x",
          version: 1,
          content: "{",
        }],
      }) as never
    );
    const source = captureSource(query, "capture");
    await source.refresh();
    expect(source.overview().requests).toEqual([]);
  });
});
