// The specification as a Slack modal: one field per part, lists one item a
// line, so a spec can be written in Slack without JSON. Slack caps a text
// field at 3000 characters.
import type { SpecificationContent } from "../domain/index.ts";

export const FIELD_MAX = 3_000;

type Field = {
  id: string;
  label: string;
  hint?: string;
  multiline?: boolean;
  optional?: boolean;
};

const FIELDS: Field[] = [
  { id: "problemStatement", label: "Problem", multiline: true },
  { id: "desiredOutcome", label: "Desired outcome", multiline: true },
  { id: "scopeIn", label: "In scope", hint: "One a line.", multiline: true },
  {
    id: "scopeOut",
    label: "Out of scope",
    hint: "One a line.",
    multiline: true,
    optional: true,
  },
  {
    id: "constraints",
    label: "Constraints",
    hint: "One a line.",
    multiline: true,
    optional: true,
  },
  {
    id: "assumptions",
    label: "Assumptions",
    hint: "One a line.",
    multiline: true,
    optional: true,
  },
  {
    id: "criteria",
    label: "Acceptance criteria",
    hint: "One a line, as ID: text, such as AC1: A count takes under a minute.",
    multiline: true,
  },
  {
    id: "examples",
    label: "Recipe examples",
    hint:
      "One a line, as phrase => what the answer shows. A requested phrase stays first, as asked.",
    multiline: true,
  },
  {
    id: "whenEmpty",
    label: "When there is nothing to show (whenEmpty)",
    multiline: true,
    optional: true,
  },
  {
    id: "pieces",
    label: "Pieces taken from the phrase",
    hint: "One a line, as name: int, repo or word.",
    multiline: true,
    optional: true,
  },
  {
    id: "candidateExtensions",
    label: "Extensions to start from",
    hint: "One a line.",
    multiline: true,
    optional: true,
  },
  {
    id: "changes",
    label: "What it changes",
    hint: "One a line. Needed when it writes; empty when it only reads.",
    multiline: true,
    optional: true,
  },
];

const lines = (text: string) =>
  text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

/** The spec's parts as the modal shows them. */
export function specToFields(
  c: SpecificationContent | undefined,
): Record<string, string> {
  return {
    problemStatement: c?.problemStatement ?? "",
    desiredOutcome: c?.desiredOutcome ?? "",
    scopeIn: (c?.scope.in ?? []).join("\n"),
    scopeOut: (c?.scope.out ?? []).join("\n"),
    constraints: (c?.constraints ?? []).join("\n"),
    assumptions: (c?.assumptions ?? []).join("\n"),
    criteria: (c?.acceptanceCriteria ?? []).map((a) => `${a.id}: ${a.text}`)
      .join("\n"),
    examples: (c?.recipe?.examples ?? []).map((e) =>
      `${e.phrase} => ${e.answer}`
    ).join("\n"),
    whenEmpty: c?.recipe?.whenEmpty ?? "",
    pieces: (c?.recipe?.pieces ?? []).map((p) => `${p.name}: ${p.shape}`)
      .join("\n"),
    candidateExtensions: (c?.recipe?.candidateExtensions ?? []).join("\n"),
    changes: (c?.effects?.changes ?? []).join("\n"),
  };
}

/**
 * The spec from the modal. Capture checks it when it is saved; this only
 * reads the lines. `effects` is read, write, or blank to keep the one there.
 */
export function fieldsToSpec(
  f: Record<string, string>,
  effects: string,
): Record<string, unknown> {
  const pair = (line: string, sep: string) => {
    const at = line.indexOf(sep);
    return at < 0
      ? [line.trim(), ""]
      : [line.slice(0, at).trim(), line.slice(at + sep.length).trim()];
  };
  return {
    problemStatement: f.problemStatement ?? "",
    desiredOutcome: f.desiredOutcome ?? "",
    scope: { in: lines(f.scopeIn ?? ""), out: lines(f.scopeOut ?? "") },
    constraints: lines(f.constraints ?? ""),
    assumptions: lines(f.assumptions ?? ""),
    acceptanceCriteria: lines(f.criteria ?? "").map((l, i) => {
      const [id, text] = pair(l, ":");
      return text ? { id, text } : { id: `AC${i + 1}`, text: id };
    }),
    recipe: {
      examples: lines(f.examples ?? "").map((l) => {
        const [phrase, answer] = pair(l, "=>");
        return { phrase, answer };
      }),
      pieces: lines(f.pieces ?? "").map((l) => {
        const [name, shape] = pair(l, ":");
        return { name, shape };
      }),
      whenEmpty: (f.whenEmpty ?? "").trim(),
      candidateExtensions: lines(f.candidateExtensions ?? ""),
    },
    ...((effects === "read" || effects === "write") && {
      effects: { kind: effects, changes: lines(f.changes ?? "") },
    }),
  };
}

const text = (t: string) => ({ type: "plain_text", text: t });

/** The modal's input blocks, filled in from `values`. */
export function specBlocks(
  values: Record<string, string>,
  effects: string | undefined,
): unknown[] {
  const effectOptions = [
    { text: text("It only reads"), value: "read" },
    { text: text("It changes things"), value: "write" },
  ];
  const blocks: unknown[] = FIELDS.map((f) => ({
    type: "input",
    block_id: f.id,
    optional: f.optional ?? false,
    label: text(f.label),
    ...(f.hint && { hint: text(f.hint) }),
    element: {
      type: "plain_text_input",
      action_id: "v",
      multiline: f.multiline ?? false,
      max_length: FIELD_MAX,
      ...(values[f.id] && { initial_value: values[f.id] }),
    },
  }));
  blocks.splice(FIELDS.findIndex((f) => f.id === "changes"), 0, {
    type: "input",
    block_id: "effects",
    optional: true,
    label: text("Reads or writes"),
    hint: text("Left blank, the one already there is kept."),
    element: {
      type: "static_select",
      action_id: "v",
      options: effectOptions,
      ...(effects && {
        initial_option: effectOptions.find((o) => o.value === effects),
      }),
    },
  });
  return blocks;
}

/** A field too long for Slack, by its label; null when they all fit. */
export function tooLong(values: Record<string, string>): string | null {
  const f = FIELDS.find((f) => (values[f.id] ?? "").length > FIELD_MAX);
  return f ? f.label : null;
}
