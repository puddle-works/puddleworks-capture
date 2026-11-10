// Capture reads build-result/v1 and /v2 as the Factory writes them, so it
// tests against the Factory's own examples. It lives here, not beside the reader, because the
// extension never names the other apps (independence_test.ts). CI checks the
// Factory out into factory/; a checkout beside this one works too. With
// neither, or before the Factory has an example of a version, its test is
// skipped.
import { assertEquals } from "@std/assert";
import { parseBuildResult } from "../extensions/models/_lib/domain/index.ts";

function factoryExample(name: string): URL | undefined {
  for (const dir of ["../factory/", "../../puddleworks-factory/"]) {
    const file = new URL(`${dir}docs/contracts/${name}`, import.meta.url);
    try {
      Deno.statSync(file);
      return file;
    } catch {
      // Not checked out there.
    }
  }
}

for (const version of ["v1", "v2"] as const) {
  const example = factoryExample(`build-result.${version}.example.json`);
  Deno.test({
    name: `reads the Factory's build-result/${version} example`,
    ignore: example === undefined,
    fn: async () => {
      const parsed = parseBuildResult(
        JSON.parse(await Deno.readTextFile(example!)),
      );
      assertEquals(parsed.ok ? [] : parsed.problems, []);
      assertEquals(
        parsed.ok && parsed.result.apiVersion,
        `puddleworks.dev/build-result/${version}`,
      );
    },
  });
}
