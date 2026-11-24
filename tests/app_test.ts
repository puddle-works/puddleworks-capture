// The Capture app (extensions/apps/capture) only reads, and sends nothing
// anywhere: Capture holds people's emails. The dashboard lets an app fetch
// from any https site, so the app's own page policy and source must not.
import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";

const app = join(import.meta.dirname!, "../extensions/apps/capture");
const read = (path: string) =>
  Deno.readTextFileSync(path.startsWith("/") ? path : join(app, path));

Deno.test("the app asks only to read data, and to run nothing", () => {
  const yaml = read("app.yaml");
  const field = (name: string) =>
    new RegExp(`^${name}:\\s*(.*)$`, "m").exec(yaml)?.[1]?.trim();
  assertEquals(field("capabilities"), "[data:read]");
  assertEquals(field("run"), "[]");
  assertEquals(field("methods"), "[]");
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
