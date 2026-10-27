import { describe, expect, it } from "./test_bdd.ts";
import {
  editSpecification,
  inviteParticipant,
  openQuestions,
  postMessage,
  propose,
  resolveQuestion,
  withdraw,
} from "./index.ts";
import {
  builder,
  colleague,
  discussingRequest,
  draftRequest,
  goodSpec,
  owner,
  T1,
  T2,
} from "./test_fixtures.ts";

describe("discussion", () => {
  it("keeps messages in the order they were posted", () => {
    let r = postMessage(discussingRequest(), builder, {
      id: "m1",
      kind: "comment",
      body: "Hi",
    }, T1);
    r = postMessage(r, owner, {
      id: "m2",
      kind: "decision",
      body: "Phones only",
    }, T2);
    expect(r.messages.map((m) => [m.id, m.authorId, m.kind])).toEqual([
      ["m1", builder.userId, "comment"],
      ["m2", owner.userId, "decision"],
    ]);
  });

  it("refuses empty messages, observers, drafts and closed requests", () => {
    expect(() =>
      postMessage(discussingRequest(), owner, {
        id: "m",
        kind: "comment",
        body: " ",
      }, T1)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    const withObserver = inviteParticipant(
      discussingRequest(),
      owner,
      colleague,
      "observer",
      T1,
    );
    expect(() =>
      postMessage(withObserver, colleague, {
        id: "m",
        kind: "comment",
        body: "x",
      }, T1)
    )
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
    expect(() =>
      postMessage(draftRequest(), owner, {
        id: "m",
        kind: "comment",
        body: "x",
      }, T1)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
    const closed = withdraw(discussingRequest(), owner, "", T1);
    expect(() =>
      postMessage(closed, owner, { id: "m", kind: "comment", body: "x" }, T1)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
  });

  it("refuses a message id that is already used", () => {
    const r = postMessage(discussingRequest(), owner, {
      id: "m1",
      kind: "comment",
      body: "x",
    }, T1);
    expect(() =>
      postMessage(r, owner, { id: "m1", kind: "comment", body: "y" }, T1)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("lists unresolved questions as open, and resolves them", () => {
    let r = postMessage(discussingRequest(), builder, {
      id: "q1",
      kind: "question",
      body: "How many sites?",
    }, T1);
    r = postMessage(
      r,
      owner,
      { id: "m2", kind: "comment", body: "Just one." },
      T1,
    );
    expect(openQuestions(r).map((m) => m.id)).toEqual(["q1"]);
    r = resolveQuestion(r, owner, "q1", "m2", T2);
    expect(openQuestions(r)).toEqual([]);
    expect(r.messages[0]).toMatchObject({
      resolvedBy: owner.userId,
      resolvedAt: T2,
      resolutionMessageId: "m2",
    });
  });

  it("only resolves an open question", () => {
    const r = postMessage(discussingRequest(), owner, {
      id: "m1",
      kind: "comment",
      body: "x",
    }, T1);
    expect(() => resolveQuestion(r, owner, "m1", null, T1))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => resolveQuestion(r, owner, "nope", null, T1))
      .toThrowError(expect.objectContaining({ code: "not_found" }));
  });

  it("won't propose a spec while a question is open", () => {
    let r = postMessage(discussingRequest(), builder, {
      id: "q1",
      kind: "question",
      body: "Sites?",
    }, T1);
    r = editSpecification(r, builder, goodSpec, ["q1"], T1);
    expect(() => propose(r, builder, T1)).toThrowError(
      expect.objectContaining({
        code: "invalid_state",
        message: expect.stringContaining("open question"),
      }),
    );
  });
});
