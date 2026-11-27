// Capture ships its own puddlerouter recipe: "last 5 things in capture"
// answered from list_requests, for the desk's requester, with no model call.
// @puddleworks/recipes reads the workflow's puddlerouterRecipe tag and runs
// its one step's method itself; these tests hold the tag and the step to what
// it accepts.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";

const root = join(import.meta.dirname!, "..");
const FILE = "workflow-capture-latest-requests.yaml";
const read = (path: string) => Deno.readTextFileSync(join(root, path));
const text = read(`workflows/${FILE}`);
const manifest = read("manifest.yaml");
// The entries of one top-level list in manifest.yaml.
const listed = (key: string) =>
  (new RegExp(`^${key}:\\n((?:  - .*\\n)+)`, "m").exec(manifest)?.[1] ?? "")
    .split("\n").filter(Boolean).map((line) => line.slice(4));
// The tag is one single-quoted YAML string holding the recipe as JSON.
const tag = /^ {2}puddlerouterRecipe: '(.*)'$/m.exec(text)?.[1] ?? "";
const recipe = JSON.parse(tag.replaceAll("''", "'"));
// As @puddleworks/recipes compiles it: the whole turn, any case.
const pattern = new RegExp(`^(?:${recipe.pattern})$`, "i");
const count = (turn: string) => pattern.exec(turn.trim())?.[1];

Deno.test("the extension ships the recipe and is labelled a recipe pack", () => {
  assert(listed("workflows").includes(FILE));
  assert(listed("labels").includes("puddlerouter-recipe"));
  // Capture has write methods, so it never claims to only read.
  assertFalse(listed("labels").includes("effects-read"));
});

Deno.test("the recipe answers the agreed phrases and their variants", () => {
  assertEquals(count("last 5 things in capture"), "5");
  assertEquals(count("show me the last 3 requests in capture"), "3");
  assertEquals(count("Latest 12 items in Capture?"), "12");
  assertEquals(count("what are the recent 99 things in capture."), "99");
  assertEquals(count("list last 1 requests in capture!"), "1");
  assertEquals(count("give me latest 7 things in capture"), "7");
});

Deno.test("the recipe leaves other turns to the model", () => {
  for (
    const turn of [
      "fix the last 5 things in capture code",
      "last 5 things in capture code",
      "last 0 things in capture",
      "last 100 things in capture",
      "last five things in capture",
      "last 5 things",
      "delete the last 5 things in capture",
    ]
  ) {
    assertEquals(count(turn), undefined, turn);
  }
});

Deno.test("the recipe lists the requester's own requests, at most the count", () => {
  assertEquals(recipe.id, "capture-last-requests");
  assertEquals(recipe.extension, "@puddleworks/capture/requests");
  assertEquals(recipe.inputs, { max: { capture: 1, as: "int" } });
  assertEquals(recipe.requester, "as");
  // One step, the method the recipe runs, fed only by the recipe's inputs.
  assertEquals(text.match(/^ {6}- name: /gm)?.length, 1);
  assertEquals(
    text.split("\n        task:\n")[1].trimEnd(),
    [
      "          type: model_method",
      "          modelIdOrName: capture",
      "          methodName: list_requests",
      "          inputs:",
      "            scope: mine",
      "            max: ${{ inputs.max }}",
      "            as: ${{ inputs.as }}",
    ].join("\n"),
  );
  // list_requests writes requests-<scope>-<status or all>.
  assertEquals(recipe.dataName, "requests-mine-all");
});

Deno.test("the answer is a count, then one line per request, or the empty text", () => {
  assertEquals(recipe.each, {
    path: "items",
    line: "#{number} {title} ({status})",
  });
  assertEquals(recipe.template, "Last {count} in Capture:\n{lines}");
  assertEquals(recipe.empty, "Nothing in Capture yet.");
});

Deno.test("the recipe says which request it answers", () => {
  assertEquals(recipe.source, {
    url: "http://127.0.0.1:3002/requests/ac813583-f77b-44cf-a8b8-d3bc80ea0b96",
    version: 1,
  });
});
