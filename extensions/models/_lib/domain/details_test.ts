import { describe, expect, it } from "./test_bdd.ts";
import {
  allowedActions,
  editDetails,
  inviteParticipant,
  postMessage,
  recordExport,
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

  it("keeps the fields it isn't given", () => {
    const r = editDetails(draftRequest(), owner, { title: "Friday" }, T1);
    expect(r.currentProcess).toBe("Paper sheet, then a spreadsheet.");
  });

  it("records nothing in the history while it is a draft", () => {
    const r = editDetails(draftRequest(), owner, { title: "Friday" }, T1);
    expect(r.transitions).toEqual([]);
  });

  it("lets the outcome owner change them while it is being discussed", () => {
    const r = editDetails(discussingRequest(), owner, {
      title: "Friday stock count",
      initialDescription: "We count stock every Friday night.",
    }, T1);
    expect(r).toMatchObject({
      status: "discussing",
      title: "Friday stock count",
      initialDescription: "We count stock every Friday night.",
      updatedAt: T1,
    });
    expect(r.transitions.at(-1)).toEqual({
      from: "discussing",
      to: "discussing",
      action: "editDetails",
      by: owner.userId,
      at: T1,
      note: 'Title was "Stock counts". The description changed.',
    });
  });

  it("records only what actually changed once submitted", () => {
    const before = discussingRequest();
    const same = editDetails(before, owner, { title: "Stock counts" }, T1);
    expect(same.transitions).toEqual(before.transitions);
    const r = editDetails(before, owner, { currentProcess: "Paper" }, T1);
    expect(r.transitions.at(-1)?.note).toBe("The current process changed.");
  });

  it("refuses once a specification is up for agreement or agreed", () => {
    for (const r of [readyRequest(), agreedRequest()]) {
      expect(() => editDetails(r, owner, { title: "x" }, T1))
        .toThrowError(expect.objectContaining({ code: "invalid_state" }));
    }
  });

  it("refuses from anyone else, and an empty title", () => {
    expect(() => editDetails(discussingRequest(), builder, { title: "x" }, T1))
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
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
      "transferOwnership",
      "editSpecification",
    ]);
  });

  it("offers the outcome owner editing the details while discussing", () => {
    expect(allowedActions(discussingRequest(), owner)).toContain("editDetails");
    expect(allowedActions(readyRequest(), owner)).not.toContain("editDetails");
    expect(allowedActions(discussingRequest(), builder)).not.toContain(
      "editDetails",
    );
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

  it("offers export, revise, starting to build and recording a build result once agreed", () => {
    expect(
      allowedActions(
        recordExport(agreedRequest(), owner, "markdown", T1),
        builder,
      ),
    ).toEqual([
      "revise",
      "startBuilding",
      "recordBuildResult",
      "export",
      "message",
      "invite",
    ]);
  });

  it("offers nothing to someone who can't see the request", () => {
    expect(allowedActions(draftRequest(), stranger)).toEqual([]);
  });
});
