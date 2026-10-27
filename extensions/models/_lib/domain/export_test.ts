import { readFileSync } from "node:fs";
import { describe, expect, it } from "./test_bdd.ts";
import {
  canonicalJson,
  OUTCOME_SPEC_V1,
  OutcomeSpecV1Schema,
  postMessage,
  specHashInput,
  toMarkdown,
  toOutcomeSpecV1,
} from "./index.ts";
import {
  agreedRequest,
  builder,
  discussingRequest,
  goodSpec,
  owner,
  T2,
} from "./test_fixtures.ts";

const PAGE = "https://capture.example/requests/r-1";

describe("canonical JSON", () => {
  it("sorts keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
  });

  it("gives the same text for the same spec whatever the key order", () => {
    const shuffled = {
      ...goodSpec,
      problemStatement: goodSpec.problemStatement,
    };
    const reordered = Object.fromEntries(Object.entries(shuffled).reverse());
    expect(specHashInput(reordered as typeof goodSpec)).toBe(
      specHashInput(goodSpec),
    );
  });
});

describe("outcome-spec/v1", () => {
  it("is the agreed spec, the agreement and the people, nothing about how to build it", () => {
    const doc = toOutcomeSpecV1(agreedRequest(), T2, PAGE);
    expect(doc).toEqual({
      format: OUTCOME_SPEC_V1,
      request: {
        id: "r-1",
        title: "Stock counts",
        initialDescription: "We count stock every Friday.",
        currentProcess: "Paper sheet, then a spreadsheet.",
        url: PAGE,
      },
      specification: { version: 1, ...goodSpec },
      agreement: {
        agreedBy: { name: owner.name, email: owner.email },
        agreedAt: T2,
        specHash: "hash-v1",
      },
      participants: [
        { role: "outcome_owner", name: owner.name, email: owner.email },
        { role: "builder", name: builder.name, email: builder.email },
      ],
      openQuestions: [],
      exportedAt: T2,
    });
    expect(OutcomeSpecV1Schema.parse(doc)).toEqual(doc);
  });

  it("lists questions asked after agreement", () => {
    const r = postMessage(agreedRequest(), builder, {
      id: "q9",
      kind: "question",
      body: "Which printer?",
    }, T2);
    expect(toOutcomeSpecV1(r, T2, PAGE).openQuestions).toEqual([
      { question: "Which printer?", askedBy: builder.name, askedAt: T2 },
    ]);
  });

  it("refuses a request with nothing agreed", () => {
    expect(() => toOutcomeSpecV1(discussingRequest(), T2, PAGE))
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
  });

  it("matches the example file", () => {
    const example = JSON.parse(
      readFileSync(
        new URL("./examples/outcome-spec-v1.example.json", import.meta.url),
        "utf8",
      ),
    );
    expect(OutcomeSpecV1Schema.parse(example)).toEqual(example);
    expect(example.format).toBe(OUTCOME_SPEC_V1);
  });

  it("rejects a request link that isn't a URL", () => {
    const doc = toOutcomeSpecV1(agreedRequest(), T2, "/requests/r-1");
    expect(OutcomeSpecV1Schema.safeParse(doc).success).toBe(false);
  });

  it("rejects a document with a different format string", () => {
    const doc = {
      ...toOutcomeSpecV1(agreedRequest(), T2, PAGE),
      format: "puddleworks.dev/app-spec/v1",
    };
    expect(OutcomeSpecV1Schema.safeParse(doc).success).toBe(false);
  });
});

describe("Markdown", () => {
  it("reads as a document anyone can pick up", () => {
    expect(toMarkdown(toOutcomeSpecV1(agreedRequest(), T2, PAGE))).toBe(
      `# Stock counts

Outcome specification, version 1. Agreed by Olive Owner (olive@example.com) on 2026-10-22.

## Problem

Weekly stock counts are typed into a spreadsheet by hand.

## Desired outcome

Counts are entered once and the order list is ready.

## In scope

- Entering counts
- Order list

## Out of scope

- Supplier ordering

## Constraints

- Works on a phone in the stockroom

## Assumptions

- One stockroom

## Acceptance criteria

- [ ] **AC1** A count can be entered in under a minute
- [ ] **AC2** The order list matches the spreadsheet for last week

## Open questions

None.

## How it is done today

Paper sheet, then a spreadsheet.

## People

- Olive Owner (olive@example.com), outcome owner
- Bea Builder (bea@example.com), builder

---

puddleworks.dev/outcome-spec/v1 · [request r-1](https://capture.example/requests/r-1) · spec hash hash-v1
`,
    );
  });

  it("writes None. for empty lists", () => {
    const doc = toOutcomeSpecV1(agreedRequest(), T2, PAGE);
    const md = toMarkdown({
      ...doc,
      specification: { ...doc.specification, constraints: [] },
    });
    expect(md).toContain("## Constraints\n\nNone.\n");
  });
});
