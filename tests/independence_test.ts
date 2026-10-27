// Capture stands alone (ADR-002, ADR-003): the extension is the whole product,
// and it never reaches into the other Puddleworks apps.
import { assertEquals, assertGreater } from "@std/assert";
import { join, relative } from "@std/path";

const root = join(import.meta.dirname!, "..");

function files(dir: string): string[] {
  const found: string[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    if (entry.name === "dist") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory) found.push(...files(path));
    else found.push(path);
  }
  return found;
}

const at = (path: string) => relative(root, path);
const code = ["extensions", "web", "workflows"].flatMap((d) =>
  files(join(root, d))
);

Deno.test("scans something", () => {
  assertGreater(code.length, 0);
});

Deno.test("never mentions the other Puddleworks apps or their vaults", () => {
  const forbidden = [
    /@mesgme\//,
    /vault\.get/,
    /puddleworks-(factory|distribution)/i,
  ];
  const hits = code.flatMap((path) => {
    const text = Deno.readTextFileSync(path);
    return forbidden.filter((re) => re.test(text)).map((re) =>
      `${at(path)}: ${re}`
    );
  });
  assertEquals(hits, []);
});

// A request is a request. "Puddleworks" and the header's "puddle works"
// wordmark are the brand, so only the bare word is caught.
Deno.test("never calls a request a puddle", () => {
  // assets.ts is the page minified, built from web/src, which is scanned.
  const source = code.filter((path) => !path.endsWith("_lib/web/assets.ts"));
  const hits = source.flatMap((path) =>
    Deno.readTextFileSync(path)
      .split("\n")
      .map((line, i) => ({ line, where: `${at(path)}:${i + 1}` }))
      .filter(({ line }) =>
        /\bpuddles?\b(?! <span class(Name)?="brand-accent">works<\/span>)/i
          .test(line)
      )
      .map(({ where }) => where)
  );
  assertEquals(hits, []);
});

Deno.test("keeps the domain free of I/O, so a phone app can use it", () => {
  const domain = files(join(root, "extensions/models/_lib/domain")).filter(
    (path) => path.endsWith(".ts") && !/_test\.ts$|test_\w+\.ts$/.test(path),
  );
  assertGreater(domain.length, 0);
  const imports = domain.flatMap((path) =>
    [...Deno.readTextFileSync(path).matchAll(/from "([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((spec) => !spec.startsWith("./") && !spec.startsWith("npm:zod@"))
      .map((spec) => `${at(path)}: ${spec}`)
  );
  assertEquals(imports, []);
});
