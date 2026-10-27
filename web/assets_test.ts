// The embedded page must be built from the current source. The digest is
// recomputed here rather than by rebuilding, which would depend on the Deno
// version that bundles.
import { assert, assertEquals } from "@std/assert";
import {
  VIEWER_ASSETS,
  VIEWER_SOURCE_DIGEST,
} from "../extensions/models/_lib/web/assets.ts";
import { LIB_INPUTS, libImports, viewerSourceDigest } from "./build.ts";

Deno.test("the embedded page is built from the current source (run deno task build:web)", async () => {
  assertEquals(VIEWER_SOURCE_DIGEST, await viewerSourceDigest());
});

Deno.test("LIB_INPUTS lists every extension module the page imports", async () => {
  assertEquals(await libImports(), [...LIB_INPUTS].sort());
});

Deno.test("the page's files are all embedded", () => {
  assertEquals(Object.keys(VIEWER_ASSETS).sort(), [
    "app.js",
    "favicon.svg",
    "index.html",
    "web.css",
  ]);
  assert(VIEWER_ASSETS["index.html"].text?.includes(`src="/app.js"`));
  assert(VIEWER_ASSETS["app.js"].type.startsWith("text/javascript"));
});
