import { describe, expect, it } from "./test_bdd.ts";
import {
  inviteParticipant,
  openQuestions,
  recordReview,
  reviewPrompt,
} from "./index.ts";
import {
  builder,
  discussingRequest,
  goodSpec,
  owner,
  readyRequest,
  reviewer,
  T2,
} from "./test_fixtures.ts";

/** Ready for agreement, with the reviewer on it. */
function reviewing() {
  return inviteParticipant(readyRequest(), owner, reviewer, "reviewer", T2);
}

function ids() {
  let n = 0;
  return () => `m${++n}`;
}

const findings = [
  { id: "F1", text: "AC1 doesn't say who enters the count." },
  { id: "F2", text: "Nothing says what happens to last week's counts." },
];

describe("recording a review", () => {
  it("posts each finding as a question and the verdict as a decision", () => {
    const r = recordReview(
      reviewing(),
      reviewer,
      {
        verdict: "minor_revision",
        summary: "Two small gaps.",
        findings,
      },
      { newId: ids() },
      T2,
    );
    expect(r.messages.map((m) => [m.id, m.kind, m.authorId])).toEqual([
      ["m1", "question", reviewer.userId],
      ["m2", "question", reviewer.userId],
      ["m3", "decision", reviewer.userId],
    ]);
    expect(r.messages[0].body).toBe(
      "F1: AC1 doesn't say who enters the count.",
    );
    expect(r.messages[2].body).toBe(
      "Review of version 1: minor revision. Two small gaps.",
    );
    expect(openQuestions(r)).toHaveLength(2);
    // A minor revision leaves it up for agreement, waiting on the questions.
    expect(r.status).toBe("ready_for_agreement");
  });

  it("asks for changes on a major revision or when it isn't safe", () => {
    for (const verdict of ["major_revision", "not_safe"] as const) {
      const r = recordReview(
        reviewing(),
        reviewer,
        {
          verdict,
          summary: "",
          findings,
        },
        { newId: ids() },
        T2,
      );
      expect(r.status).toBe("discussing");
      expect(r.specifications.at(-1)!.status).toBe("changes_requested");
      expect(r.transitions.at(-1)).toMatchObject({
        action: "requestChanges",
        by: reviewer.userId,
      });
    }
  });

  it("records a ready verdict with no findings as a decision only", () => {
    const r = recordReview(
      reviewing(),
      reviewer,
      {
        verdict: "ready",
        findings: [],
      },
      { newId: ids() },
      T2,
    );
    expect(r.messages.map((m) => m.kind)).toEqual(["decision"]);
    expect(r.messages[0].body).toBe(
      "Review of version 1: ready. No findings.",
    );
    expect(r.status).toBe("ready_for_agreement");
  });

  it("refuses anyone who isn't a reviewer on the request", () => {
    for (const who of [owner, builder]) {
      expect(() =>
        recordReview(reviewing(), who, { verdict: "ready", findings: [] }, {
          newId: ids(),
        }, T2)
      ).toThrowError(expect.objectContaining({ code: "not_allowed" }));
    }
  });

  it("refuses a request that isn't ready for agreement", () => {
    const r = inviteParticipant(
      discussingRequest(),
      owner,
      reviewer,
      "reviewer",
      T2,
    );
    expect(() =>
      recordReview(r, reviewer, { verdict: "ready", findings: [] }, {
        newId: ids(),
      }, T2)
    ).toThrowError(expect.objectContaining({ code: "invalid_state" }));
  });

  it("refuses a review of another version than the one up for agreement", () => {
    expect(() =>
      recordReview(reviewing(), reviewer, { verdict: "ready", findings: [] }, {
        newId: ids(),
        version: 2,
      }, T2)
    ).toThrowError(expect.objectContaining({ code: "invalid_state" }));
  });

  it("refuses badly shaped findings", () => {
    const bad: unknown[] = [
      { verdict: "fine", findings: [] },
      { verdict: "ready" },
      { verdict: "ready", findings: [{ id: "F1" }] },
      { verdict: "ready", findings: [{ id: "", text: "x" }] },
      { verdict: "ready", findings: [{ id: "F1", text: " " }] },
      { verdict: "ready", findings: [findings[0], findings[0]] },
    ];
    for (const review of bad) {
      expect(() =>
        // deno-lint-ignore no-explicit-any
        recordReview(reviewing(), reviewer, review as any, {
          newId: ids(),
        }, T2)
      ).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    }
  });
});

describe("the review prompt", () => {
  it("holds the frozen specification and asks for the review as JSON", () => {
    const prompt = reviewPrompt(reviewing());
    expect(prompt).toMatch(/Stock counts/);
    expect(prompt).toMatch(/version 1/);
    for (const { id, text } of goodSpec.acceptanceCriteria) {
      expect(prompt).toMatch(new RegExp(`${id}.*${text}`));
    }
    expect(prompt).toMatch(/Supplier ordering/);
    expect(prompt).toMatch(/"verdict"/);
    expect(prompt).toMatch(
      /ready \| minor_revision \| major_revision \| not_safe/,
    );
  });

  it("isn't given the discussion", () => {
    const r = reviewing();
    const prompt = reviewPrompt({
      ...r,
      messages: [{
        id: "m1",
        authorId: owner.userId,
        authorName: owner.name,
        kind: "comment",
        body: "Secret discussion point",
        createdAt: T2,
        resolvedAt: null,
        resolvedBy: null,
        resolutionMessageId: null,
      }],
    });
    expect(prompt.includes("Secret discussion point")).toBe(false);
  });
});
