import { describe, expect, it } from "./test_bdd.ts";
import {
  allowedActions,
  editDetails,
  inviteParticipant,
  postMessage,
  recordExport,
  submit,
} from "./index.ts";
import {
  agreedRequest,
  builder,
  discussingRequest,
  draftRequest,
  owner,
  readyRequest,
  reviewer,
  stranger,
  T1,
} from "./test_fixtures.ts";

describe("editing the request's own details", () => {
  it("lets the outcome owner change them while it is a draft", () => {
    const r = editDetails(draftRequest(), owner, {
      title: "Friday stock count",
      currentProcess: "Paper",
    }, T1);
    expect(r).toMatchObject({
      title: "Friday stock count",
      initialDescription: "We count stock every Friday.",
      currentProcess: "Paper",
      updatedAt: T1,
    });
  });

  it("refuses once submitted, from anyone else, and an empty title", () => {
    expect(() =>
      editDetails(submit(draftRequest(), owner, T1), owner, { title: "x" }, T1)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
    expect(() => editDetails(draftRequest(), stranger, { title: "x" }, T1))
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
    expect(() => editDetails(draftRequest(), owner, { title: "  " }, T1))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });
});

describe("allowed actions", () => {
  it("says what the outcome owner can do with a draft", () => {
    expect(allowedActions(draftRequest(), owner)).toEqual([
      "submit",
      "withdraw",
      "editDetails",
      "editSpecification",
    ]);
  });

  it("says what a builder can do while discussing", () => {
    expect(allowedActions(discussingRequest(), builder)).toEqual([
      "propose",
      "decline",
      "editSpecification",
      "message",
      "invite",
    ]);
  });

  it("offers a builder who isn't on a submitted request only to join", () => {
    const other = { ...stranger, isBuilder: true };
    expect(allowedActions(discussingRequest(), other)).toEqual(["join"]);
  });

  it("offers agree to the outcome owner only", () => {
    expect(allowedActions(readyRequest(), owner)).toContain("agree");
    expect(allowedActions(readyRequest(), builder)).not.toContain("agree");
  });

  it("holds back agree while a question is open", () => {
    const r = postMessage(readyRequest(), owner, {
      id: "q1",
      kind: "question",
      body: "Which week?",
    }, T1);
    expect(allowedActions(r, owner)).not.toContain("agree");
    expect(allowedActions(r, owner)).toContain("requestChanges");
  });

  it("offers a reviewer only posting and asking for changes", () => {
    const r = inviteParticipant(
      readyRequest(),
      owner,
      reviewer,
      "reviewer",
      T1,
    );
    expect(allowedActions(r, reviewer)).toEqual(["requestChanges", "message"]);
  });

  it("offers export and revise once agreed", () => {
    expect(
      allowedActions(
        recordExport(agreedRequest(), owner, "markdown", T1),
        builder,
      ),
    ).toEqual([
      "export",
      "revise",
      "message",
      "invite",
    ]);
  });

  it("offers nothing to someone who can't see the request", () => {
    expect(allowedActions(draftRequest(), stranger)).toEqual([]);
  });
});
