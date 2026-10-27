// Builds the viewer page (deno task build:web), as stagecraft builds its
// studio. It bundles src/app.tsx for the browser into dist/ (a scratch
// directory git ignores), adds the page's HTML, CSS and icon, and writes every
// served file into extensions/models/_lib/web/assets.ts, which the serve
// method serves from. The page is embedded because a behavior pulled as an
// extension runs from swamp's bundle directory, where no dist/ is beside it.
//
// The build's inputs are web/src, this file, the extension modules the page
// imports (LIB_INPUTS), and deno.json and deno.lock, which pin the packages
// the bundle contains. assets.ts records a digest of them all; assets_test
// recomputes it, so a stale page fails the unit tests without rebuilding.
import { extname, fromFileUrl, relative } from "@std/path";

const WEB = new URL("./", import.meta.url);
const ROOT = new URL("../", WEB);
const SRC = new URL("src/", WEB);
const DIST = new URL("dist/", WEB);
const LIB = new URL("extensions/models/_lib/", ROOT);
const ASSETS_MODULE = new URL("web/assets.ts", LIB);

/**
 * The extension modules the page's source reaches, by path in
 * extensions/models/_lib/. The page imports only their types, but a change to
 * them can change what it shows, so they are inputs. The build refuses a graph
 * that differs, and assets_test compares this list with a walk of the imports.
 */
export const LIB_INPUTS = [
  "capture/ports.ts",
  "capture/view_types.ts",
  "domain/model.ts",
];

/** The page's tests, which are never bundled. */
const isTestFile = (path: string) => /_test\.tsx?$/.test(path);

async function filesUnder(dir: URL): Promise<URL[]> {
  const found: URL[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const url = new URL(entry.isDirectory ? `${entry.name}/` : entry.name, dir);
    if (entry.isDirectory) found.push(...await filesUnder(url));
    else if (entry.isFile) found.push(url);
  }
  return found;
}

const fromRoot = (url: URL) =>
  relative(fromFileUrl(ROOT), fromFileUrl(url)).replaceAll("\\", "/");

/** The build's inputs, by path relative to the repo, in a fixed order. */
export async function viewerInputs(): Promise<string[]> {
  const files = [
    ...(await filesUnder(SRC)).filter((url) => !isTestFile(url.pathname)),
    new URL("build.ts", WEB),
    ...LIB_INPUTS.map((path) => new URL(path, LIB)),
    new URL("deno.json", ROOT),
    new URL("deno.lock", ROOT),
  ];
  return files.map(fromRoot).sort();
}

// An import or export-from statement that starts a line, so a comment or a
// string that mentions the words never matches.
const IMPORT =
  /^\s*(?:import\s*["']([^"']+)["']|(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["'])/gm;

/**
 * The extension modules the page's source reaches, by path under _lib/,
 * found by reading static import lines from web/src (tests aside) and on
 * through the modules they reach. It reads files only, so the tests can run it.
 */
export async function libImports(): Promise<string[]> {
  const found = new Set<string>();
  const queue = (await filesUnder(SRC)).filter((url) =>
    /\.tsx?$/.test(url.pathname) && !isTestFile(url.pathname)
  );
  const visited = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file.href)) continue;
    visited.add(file.href);
    const text = await Deno.readTextFile(file);
    for (const [, a, b] of text.matchAll(IMPORT)) {
      const spec = a ?? b;
      if (!spec.startsWith(".") || !/\.tsx?$/.test(spec)) continue;
      const url = new URL(spec, file);
      if (url.href.startsWith(LIB.href)) {
        found.add(url.href.slice(LIB.href.length));
      }
      queue.push(url);
    }
  }
  return [...found].sort();
}

/** sha256 over every input's path and text, with line endings as git stores them. */
export async function viewerSourceDigest(): Promise<string> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const path of await viewerInputs()) {
    const text = (await Deno.readTextFile(new URL(path, ROOT))).replaceAll(
      "\r\n",
      "\n",
    );
    const bytes = encoder.encode(text);
    parts.push(encoder.encode(`${path}\0${bytes.length}\0`), bytes);
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return `sha256:${
    Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")
  }`;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function deno(args: string[]): Promise<string> {
  const out = await new Deno.Command("deno", {
    args,
    cwd: fromFileUrl(ROOT),
    stdout: "piped",
    stderr: "piped",
  })
    .output();
  if (!out.success) {
    throw new Error(
      `deno ${args[0]} failed:\n${new TextDecoder().decode(out.stderr)}`,
    );
  }
  return new TextDecoder().decode(out.stdout);
}

/** A remote module the bundle may contain: an exact npm or JSR version. */
const PINNED = [
  /^npm:\/?(@[a-z0-9-]+\/)?[a-z0-9.-]+@\d+\.\d+\.\d+(\/|$)/,
  /^https:\/\/jsr\.io\/@std\/[a-z-]+\/\d+\.\d+\.\d+\//,
];

/** The bundle's graph must be what the digest covers: web/src, LIB_INPUTS exactly, and pinned packages. */
async function checkModuleGraph(entry: URL) {
  const info = JSON.parse(
    await deno(["info", "--json", fromFileUrl(entry)]),
  ) as { modules: { specifier: string }[] };
  const problems: string[] = [];
  const lib = new Set<string>();
  for (const { specifier } of info.modules) {
    if (specifier.startsWith(SRC.href)) continue;
    if (specifier.startsWith(LIB.href)) {
      lib.add(specifier.slice(LIB.href.length));
      continue;
    }
    if (PINNED.some((p) => p.test(specifier))) continue;
    problems.push(
      `not under web/src, the extension's _lib, or pinned: ${specifier}`,
    );
  }
  const listed = new Set(LIB_INPUTS);
  for (const path of lib) {
    if (!listed.has(path)) problems.push(`missing from LIB_INPUTS: ${path}`);
  }
  for (const path of listed) {
    if (!lib.has(path)) {
      problems.push(`not imported, drop from LIB_INPUTS: ${path}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `the page's module graph differs from the digest's inputs:\n  ${
        problems.join("\n  ")
      }`,
    );
  }
}

/**
 * A string as source, in pieces short enough for the registry's line-length
 * check: one long literal reads as hidden data, and the minified script is
 * one line. Split by code point, so no piece ends inside a character.
 */
function literal(text: string): string {
  const chars = Array.from(text);
  const pieces: string[] = [];
  for (let i = 0; i < chars.length; i += 300) {
    pieces.push(JSON.stringify(chars.slice(i, i + 300).join("")));
  }
  return pieces.length <= 1
    ? (pieces[0] ?? '""')
    : `[\n${pieces.join(",\n")},\n].join("")`;
}

async function build() {
  const entry = new URL("app.tsx", SRC);
  await checkModuleGraph(entry);
  await Deno.remove(DIST, { recursive: true }).catch(() => {});
  await Deno.mkdir(DIST, { recursive: true });
  await deno([
    "bundle",
    "--platform",
    "browser",
    "--minify",
    "-o",
    fromFileUrl(new URL("app.js", DIST)),
    fromFileUrl(entry),
  ]);
  for (const name of ["index.html", "web.css", "favicon.svg"]) {
    await Deno.copyFile(new URL(name, SRC), new URL(name, DIST));
  }

  const served = (await filesUnder(DIST)).map((url) =>
    relative(fromFileUrl(DIST), fromFileUrl(url))
  ).sort();
  const lines: string[] = [];
  for (const path of served) {
    const type = TYPES[extname(path)];
    if (type === undefined) throw new Error(`no content type for ${path}`);
    const text = await Deno.readTextFile(new URL(path, DIST));
    lines.push(
      `  ${JSON.stringify(path)}: { type: ${JSON.stringify(type)}, text: ${
        literal(text)
      } },`,
    );
  }
  const module =
    `// Generated by web/build.ts from web/src. Do not edit: change the page's
// source, then run deno task build:web.
import type { ViewerAsset } from "./server.ts";

/** A digest of the build's inputs; web/assets_test checks it is current. */
export const VIEWER_SOURCE_DIGEST = ${
      JSON.stringify(await viewerSourceDigest())
    };

/** The viewer page's files by served name. */
export const VIEWER_ASSETS: Readonly<Record<string, ViewerAsset>> = {
${lines.join("\n")}
};
`;
  await Deno.writeTextFile(ASSETS_MODULE, module);
  console.log(
    `${served.length} files, assets.ts ${(module.length / 1024).toFixed(0)} KB`,
  );
}

if (import.meta.main) await build();
