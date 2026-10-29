// Capture reads build-result/v1 as the Factory writes it, so it tests against
// the Factory's own example. It lives here, not beside the reader, because the
// extension never names the other apps (independence_test.ts). CI checks the
// Factory out into factory/; a checkout beside this one works too. With
// neither, the test is skipped.
import { assertEquals } from "@std/assert";
import { parseBuildResult } from "../extensions/models/_lib/domain/index.ts";

const EXAMPLE = "docs/contracts/build-result.v1.example.json";

function factoryExample(): URL | undefined {
  for (const dir of ["../factory/", "../../puddleworks-factory/"]) {
    const file = new URL(dir + EXAMPLE, import.meta.url);
    try {
      Deno.statSync(file);
      return file;
    } catch {
      // Not checked out there.
    }
  }
}

const example = factoryExample();

Deno.test({
  name: "reads the Factory's build-result/v1 example",
  ignore: example === undefined,
  fn: async () => {
    const parsed = parseBuildResult(
      JSON.parse(await Deno.readTextFile(example!)),
    );
    assertEquals(parsed.ok ? [] : parsed.problems, []);
  },
});
