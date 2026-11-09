// Where record_build_result's build result comes from: a file, an https URL
// or JSON given inline.
import { describe, expect, it } from "../domain/test_bdd.ts";
import { buildResult } from "../domain/test_fixtures.ts";
import { readJsonInput } from "./build_result_input.ts";

const noFetch = () => Promise.reject(new Error("no network in this test"));

describe("reading a build result to record", () => {
  it("takes an object as it is, and JSON text given inline", async () => {
    const result = buildResult();
    const deps = { repoDir: "/repo", fetch: noFetch };
    expect(await readJsonInput(result, deps)).toEqual(result);
    expect(await readJsonInput(` ${JSON.stringify(result)}`, deps))
      .toEqual(result);
  });

  it("reads a file relative to the repository, or by its full path", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${dir}/r.json`, JSON.stringify(buildResult()));
      const deps = { repoDir: dir, fetch: noFetch };
      expect(await readJsonInput("r.json", deps)).toEqual(
        buildResult(),
      );
      expect(await readJsonInput(`${dir}/r.json`, deps)).toEqual(
        buildResult(),
      );
      await expect.rejects(
        readJsonInput("missing.json", deps),
        expect.objectContaining({
          message: "There is no file missing.json in the repository.",
        }),
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("fetches an https URL, and refuses plain http", async () => {
    const asked: string[] = [];
    const fetch = (url: string) => {
      asked.push(url);
      return Promise.resolve(Response.json(buildResult()));
    };
    const url = "https://example.com/build-result.json";
    expect(await readJsonInput(url, { repoDir: "/repo", fetch }))
      .toEqual(buildResult());
    expect(asked).toEqual([url]);
    await expect.rejects(
      readJsonInput("http://example.com/r.json", {
        repoDir: "/repo",
        fetch,
      }),
      expect.objectContaining({
        message: "Fetch a build result over https, not http.",
      }),
    );
  });

  it("says when a URL doesn't answer with one", async () => {
    const fetch = () => Promise.resolve(new Response("gone", { status: 404 }));
    await expect.rejects(
      readJsonInput("https://example.com/r.json", {
        repoDir: "/repo",
        fetch,
      }),
      expect.objectContaining({
        message: "https://example.com/r.json answered 404, not a build result.",
      }),
    );
  });

  it("says when what it read isn't JSON", async () => {
    await expect.rejects(
      readJsonInput("{not json", { repoDir: "/repo", fetch: noFetch }),
      expect.objectContaining({
        message: expect.stringContaining("The build result isn't JSON"),
      }),
    );
  });
});
