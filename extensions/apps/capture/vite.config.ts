import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
// swamp writes .swamp-platform on app init, dev and build
import { swampApp } from "./.swamp-platform/app-sdk/vite.ts";

const app = fileURLToPath(new URL("./", import.meta.url));

/**
 * The page is the one the web behavior renders, from extensions/models/_lib
 * and web/src. Those modules import as Deno does (`npm:zod@4.6.7`, and
 * `preact` from deno.json), so their packages are resolved from this app's
 * node_modules, whose versions package.json pins to the same ones.
 */
function denoSpecifiers(): Plugin {
  return {
    name: "capture-deno-specifiers",
    enforce: "pre",
    resolveId(id) {
      const npm = /^npm:\/?((?:@[^/]+\/)?[^/@]+)@[^/]+(\/.*)?$/.exec(id);
      if (npm === null) return null;
      return this.resolve(`${npm[1]}${npm[2] ?? ""}`, `${app}index.html`, {
        skipSelf: true,
      });
    },
  };
}

export default defineConfig({
  plugins: [denoSpecifiers(), swampApp()],
  resolve: { dedupe: ["preact", "zod"] },
  // The preload polyfill fetches; the app loads only its own two files.
  build: { modulePreload: { polyfill: false } },
  server: {
    fs: {
      allow: [
        app,
        fileURLToPath(new URL("../../models/_lib/", import.meta.url)),
        fileURLToPath(new URL("../../../web/src/", import.meta.url)),
      ],
    },
  },
});
