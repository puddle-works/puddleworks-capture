import { describe, expect, it } from "./test_bdd.ts";
import {
  agree,
  editSpecification,
  inviteParticipant,
  latestAgreed,
  postMessage,
  propose,
  recordExport,
  requestChanges,
  resolveQuestion,
  revise,
  specificationProblems,
  submit,
} from "./index.ts";
import {
  agreedRequest,
  builder,
  colleague,
  discussingRequest,
  draftRequest,
  goodSpec,
  owner,
  readyRequest,
  T1,
  T2,
} from "./test_fixtures.ts";

const blank = {
  problemStatement: "",
  desiredOutcome: "",
  scope: { in: [], out: [] },
  constraints: [],
  assumptions: [],
  acceptanceCriteria: [],
};

describe("specification problems", () => {
  it("lists what is missing, in plain words", () => {
    expect(specificationProblems(blank)).toEqual([
      "Problem statement is empty.",
      "Desired outcome is empty.",
      "Nothing is in scope.",
      "There are no acceptance criteria.",
      "The recipe has no examples: give at least one phrase it must answer, and what the answer shows.",
    ]);
  });

  it("catches empty and duplicate acceptance criteria", () => {
    expect(
      specificationProblems({
        ...goodSpec,
        acceptanceCriteria: [{ id: "AC1", text: "x" }, {
          id: "AC1",
          text: " ",
        }],
      }),
    ).toEqual([
      "Acceptance criterion AC1 appears more than once.",
      "Acceptance criterion AC1 has no text.",
    ]);
  });

  it("finds nothing wrong with a complete spec", () => {
    expect(specificationProblems(goodSpec)).toEqual([]);
  });
});

describe("versions", () => {
  it("lets the owner start a draft spec before submitting, and keeps editing version 1", () => {
    let r = editSpecification(draftRequest(), owner, blank, [], T1);
    r = editSpecification(r, owner, goodSpec, [], T2);
    expect(r.specifications).toHaveLength(1);
    expect(r.specifications[0]).toMatchObject({
      version: 1,
      status: "draft",
      content: goodSpec,
      updatedAt: T2,
    });
    expect(submit(r, owner, T2).specifications).toHaveLength(1);
  });

  it("records which discussion points a change came from", () => {
    const r = editSpecification(discussingRequest(), builder, goodSpec, [
      "q1",
      "m3",
    ], T1);
    expect(r.specifications[0]?.basedOnMessageIds).toEqual(["q1", "m3"]);
  });

  it("refuses edits from observers, and while ready or agreed", () => {
    const withObserver = inviteParticipant(
      discussingRequest(),
      owner,
      colleague,
      "observer",
      T1,
    );
    expect(() => editSpecification(withObserver, colleague, goodSpec, [], T1))
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
    expect(() => editSpecification(readyRequest(), builder, goodSpec, [], T1))
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
    expect(() => editSpecification(agreedRequest(), builder, goodSpec, [], T1))
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
  });

  it("rejects content that doesn't fit the schema", () => {
    expect(() =>
      editSpecification(
        discussingRequest(),
        builder,
        { ...goodSpec, scope: "all" } as never,
        [],
        T1,
      )
    )
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("only proposes a complete draft", () => {
    expect(() => propose(discussingRequest(), builder, T1))
      .toThrowError(
        expect.objectContaining({
          code: "invalid_state",
          message: "There is no draft specification to propose.",
        }),
      );
    const r = editSpecification(discussingRequest(), builder, blank, [], T1);
    expect(() => propose(r, builder, T1)).toThrowError(
      expect.objectContaining({
        code: "invalid_state",
        message: expect.stringContaining("Problem statement is empty."),
      }),
    );
  });

  it("freezes the proposed version", () => {
    expect(readyRequest().specifications[0]?.status).toBe("proposed");
  });

  it("starts version 2 after changes are asked for", () => {
    let r = requestChanges(readyRequest(), owner, "Add totals", T2);
    expect(r.specifications[0]?.status).toBe("changes_requested");
    r = editSpecification(
      r,
      builder,
      { ...goodSpec, constraints: ["Totals"] },
      [],
      T2,
    );
    expect(r.specifications.map((s) => [s.version, s.status])).toEqual([
      [1, "changes_requested"],
      [2, "draft"],
    ]);
  });
});

describe("agreement", () => {
  it("is the outcome owner's alone", () => {
    expect(() =>
      agree(readyRequest(), builder, { version: 1, specHash: "h" }, T2)
    )
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
  });

  it("records who agreed to exactly which version and hash", () => {
    const r = agreedRequest();
    expect(r.specifications[0]?.status).toBe("agreed");
    expect(r.agreements).toEqual([{
      specVersion: 1,
      agreedBy: owner.userId,
      agreedAt: T2,
      specHash: "hash-v1",
    }]);
    expect(latestAgreed(r)?.version).toBe(1);
  });

  it("waits until every question raised after proposing is resolved", () => {
    const ask = (r: ReturnType<typeof readyRequest>, id: string) =>
      postMessage(r, owner, { id, kind: "question", body: "Which week?" }, T2);
    const v1 = { version: 1, specHash: "hash-v1" };
    let r = ask(readyRequest(), "q1");
    expect(() => agree(r, owner, v1, T2)).toThrowError(
      expect.objectContaining({
        code: "invalid_state",
        message: "Resolve the open question first.",
      }),
    );
    r = ask(r, "q2");
    expect(() => agree(r, owner, v1, T2)).toThrowError(
      expect.objectContaining({
        code: "invalid_state",
        message: "Resolve the 2 open questions first.",
      }),
    );
    r = resolveQuestion(r, builder, "q1", null, T2);
    r = resolveQuestion(r, owner, "q2", null, T2);
    expect(agree(r, owner, v1, T2).status).toBe("agreed");
  });

  it("refuses to agree to a version other than the one proposed", () => {
    expect(() =>
      agree(readyRequest(), owner, { version: 2, specHash: "h" }, T2)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
  });

  it("keeps the old agreement when revising, until a new one supersedes it", () => {
    let r = recordExport(agreedRequest(), builder, "markdown", T2);
    r = revise(r, owner, T2);
    expect(r.status).toBe("discussing");
    expect(r.specifications.map((s) => [s.version, s.status])).toEqual([
      [1, "agreed"],
      [2, "draft"],
    ]);
    expect(r.specifications[1]?.content).toEqual(goodSpec);
    expect(latestAgreed(r)?.version).toBe(1);

    r = editSpecification(
      r,
      builder,
      { ...goodSpec, assumptions: ["Two stockrooms"] },
      [],
      T2,
    );
    r = propose(r, builder, T2);
    r = agree(r, owner, { version: 2, specHash: "hash-v2" }, T2);
    expect(r.specifications.map((s) => [s.version, s.status])).toEqual([
      [1, "superseded"],
      [2, "agreed"],
    ]);
    expect(r.agreements.map((a) => a.specVersion)).toEqual([1, 2]);
    expect(r.exports).toEqual([{
      specVersion: 1,
      format: "markdown",
      exportedBy: builder.userId,
      exportedAt: T2,
    }]);
  });
});

describe("export record", () => {
  it("refuses a request that isn't agreed, such as one being revised", () => {
    const revising = revise(agreedRequest(), owner, T2);
    expect(() => recordExport(revising, builder, "markdown", T2))
      .toThrowError(expect.objectContaining({
        code: "invalid_state",
        message: expect.stringContaining("must be agreed"),
      }));
  });

  it("records the agreed version each time it is exported, and leaves it agreed", () => {
    let r = recordExport(agreedRequest(), owner, "outcome-spec/v1+json", T1);
    r = recordExport(r, builder, "markdown", T2);
    expect(r.status).toBe("agreed");
    expect(r.updatedAt).toBe(T2);
    expect(r.exports.map((e) => [e.specVersion, e.format, e.exportedBy]))
      .toEqual([
        [1, "outcome-spec/v1+json", owner.userId],
        [1, "markdown", builder.userId],
      ]);
  });
});
