import { describe, expect, it } from "./test_bdd.ts";
import {
  agree,
  can,
  canRead,
  decline,
  editSpecification,
  inviteParticipant,
  joinAsBuilder,
  postMessage,
  recordExport,
  removeParticipant,
  requestChanges,
  roleOf,
  submit,
  withdraw,
} from "./index.ts";
import {
  agreedRequest,
  builder,
  colleague,
  discussingRequest,
  draftRequest,
  goodSpec,
  otherBuilder,
  owner,
  readyRequest,
  reviewer,
  stranger,
  T1,
  T2,
} from "./test_fixtures.ts";

describe("who can see a request", () => {
  it("keeps a draft to its outcome owner", () => {
    const r = draftRequest();
    expect(canRead(r, owner)).toBe(true);
    expect(canRead(r, builder)).toBe(false);
  });

  it("shows a submitted request to participants and to any builder, nobody else", () => {
    const r = submit(draftRequest(), owner, T1);
    expect(canRead(r, builder)).toBe(true);
    expect(canRead(r, stranger)).toBe(false);
  });
});

describe("permission matrix", () => {
  it("matches the table in docs/architecture/standalone.md", () => {
    expect({
      outcome_owner: {
        message: can("outcome_owner", "message"),
        editSpecification: can("outcome_owner", "editSpecification"),
        propose: can("outcome_owner", "propose"),
        requestChanges: can("outcome_owner", "requestChanges"),
        agree: can("outcome_owner", "agree"),
        invite: can("outcome_owner", "invite"),
        withdraw: can("outcome_owner", "withdraw"),
        decline: can("outcome_owner", "decline"),
        export: can("outcome_owner", "export"),
      },
      builder: {
        message: can("builder", "message"),
        editSpecification: can("builder", "editSpecification"),
        propose: can("builder", "propose"),
        requestChanges: can("builder", "requestChanges"),
        agree: can("builder", "agree"),
        invite: can("builder", "invite"),
        withdraw: can("builder", "withdraw"),
        decline: can("builder", "decline"),
        export: can("builder", "export"),
      },
      observer: {
        message: can("observer", "message"),
        editSpecification: can("observer", "editSpecification"),
        propose: can("observer", "propose"),
        requestChanges: can("observer", "requestChanges"),
        agree: can("observer", "agree"),
        invite: can("observer", "invite"),
        withdraw: can("observer", "withdraw"),
        decline: can("observer", "decline"),
        export: can("observer", "export"),
      },
      reviewer: {
        message: can("reviewer", "message"),
        editSpecification: can("reviewer", "editSpecification"),
        propose: can("reviewer", "propose"),
        requestChanges: can("reviewer", "requestChanges"),
        agree: can("reviewer", "agree"),
        invite: can("reviewer", "invite"),
        withdraw: can("reviewer", "withdraw"),
        decline: can("reviewer", "decline"),
        export: can("reviewer", "export"),
      },
    }).toEqual({
      outcome_owner: {
        message: true,
        editSpecification: true,
        propose: true,
        requestChanges: true,
        agree: true,
        invite: true,
        withdraw: true,
        decline: false,
        export: true,
      },
      builder: {
        message: true,
        editSpecification: true,
        propose: true,
        requestChanges: true,
        agree: false,
        invite: true,
        withdraw: false,
        decline: true,
        export: true,
      },
      observer: {
        message: false,
        editSpecification: false,
        propose: false,
        requestChanges: false,
        agree: false,
        invite: false,
        withdraw: false,
        decline: false,
        export: false,
      },
      reviewer: {
        message: true,
        editSpecification: false,
        propose: false,
        requestChanges: true,
        agree: false,
        invite: false,
        withdraw: false,
        decline: false,
        export: false,
      },
    });
  });
});

describe("reviewing", () => {
  const withReviewer = () =>
    inviteParticipant(readyRequest(), owner, reviewer, "reviewer", T1);

  it("lets a reviewer read, post a question and ask for changes", () => {
    let r = withReviewer();
    expect(canRead(r, reviewer)).toBe(true);
    r = postMessage(r, reviewer, {
      id: "q-review",
      kind: "question",
      body: "What happens to a count entered twice?",
    }, T2);
    expect(r.messages.at(-1)).toMatchObject({
      kind: "question",
      authorId: reviewer.userId,
    });
    r = requestChanges(r, reviewer, "AC1 can't be checked", T2);
    expect(r.status).toBe("discussing");
    expect(r.transitions.at(-1)).toMatchObject({
      action: "requestChanges",
      by: reviewer.userId,
      note: "AC1 can't be checked",
    });
  });

  it("refuses a reviewer editing, agreeing, declining, inviting and exporting", () => {
    const refused = expect.objectContaining({ code: "not_allowed" });
    const ready = withReviewer();
    const discussing = inviteParticipant(
      discussingRequest(),
      owner,
      reviewer,
      "reviewer",
      T1,
    );
    expect(() => editSpecification(discussing, reviewer, goodSpec, [], T2))
      .toThrowError(refused);
    expect(() => agree(ready, reviewer, { version: 1, specHash: "h" }, T2))
      .toThrowError(refused);
    expect(() => decline(ready, reviewer, "Not needed", T2))
      .toThrowError(refused);
    expect(() => inviteParticipant(ready, reviewer, colleague, "observer", T2))
      .toThrowError(refused);
    const agreed = inviteParticipant(
      agreedRequest(),
      owner,
      reviewer,
      "reviewer",
      T2,
    );
    expect(() => recordExport(agreed, reviewer, "markdown", T2))
      .toThrowError(refused);
  });
});

describe("joining and inviting", () => {
  it("lets a builder join a submitted request, once", () => {
    const r = joinAsBuilder(submit(draftRequest(), owner, T1), builder, T1);
    expect(roleOf(r, builder.userId)).toBe("builder");
    expect(joinAsBuilder(r, builder, T1).participants).toHaveLength(2);
  });

  it("doesn't let a builder join a draft, or a non-builder join at all", () => {
    expect(() => joinAsBuilder(draftRequest(), builder, T1))
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
    expect(() => joinAsBuilder(submit(draftRequest(), owner, T1), stranger, T1))
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
  });

  it("lets the outcome owner invite an observer or a builder", () => {
    let r = inviteParticipant(
      discussingRequest(),
      owner,
      colleague,
      "observer",
      T1,
    );
    r = inviteParticipant(r, owner, otherBuilder, "builder", T1);
    expect(roleOf(r, colleague.userId)).toBe("observer");
    expect(r.participants.find((p) => p.userId === otherBuilder.userId))
      .toMatchObject({ role: "builder", invitedBy: owner.userId });
  });

  it("only makes someone a builder if they are one", () => {
    expect(() =>
      inviteParticipant(discussingRequest(), owner, colleague, "builder", T1)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("lets the outcome owner invite a reviewer, builder or not", () => {
    const r = inviteParticipant(
      discussingRequest(),
      owner,
      reviewer,
      "reviewer",
      T1,
    );
    expect(r.participants.find((p) => p.userId === reviewer.userId))
      .toMatchObject({ role: "reviewer", invitedBy: owner.userId });
  });

  it("lets a builder invite builders and reviewers only, and observers invite nobody", () => {
    expect(
      inviteParticipant(
        discussingRequest(),
        builder,
        otherBuilder,
        "builder",
        T1,
      ).participants,
    )
      .toHaveLength(3);
    expect(
      roleOf(
        inviteParticipant(
          discussingRequest(),
          builder,
          reviewer,
          "reviewer",
          T1,
        ),
        reviewer.userId,
      ),
    ).toBe("reviewer");
    expect(() =>
      inviteParticipant(discussingRequest(), builder, colleague, "observer", T1)
    )
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
    const withObserver = inviteParticipant(
      discussingRequest(),
      owner,
      colleague,
      "observer",
      T1,
    );
    expect(() =>
      inviteParticipant(withObserver, colleague, otherBuilder, "builder", T1)
    )
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
  });

  it("refuses to invite someone twice, before submitting, or once closed", () => {
    expect(() =>
      inviteParticipant(discussingRequest(), owner, builder, "builder", T1)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
    expect(() =>
      inviteParticipant(draftRequest(), owner, colleague, "observer", T1)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
    const closed = withdraw(discussingRequest(), owner, "", T1);
    expect(() => inviteParticipant(closed, owner, colleague, "observer", T1))
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
  });

  it("lets the owner remove someone and anyone but the owner leave", () => {
    expect(
      removeParticipant(discussingRequest(), owner, builder.userId, T1)
        .participants,
    )
      .toHaveLength(1);
    expect(
      removeParticipant(discussingRequest(), builder, builder.userId, T1)
        .participants,
    )
      .toHaveLength(1);
    expect(() =>
      removeParticipant(discussingRequest(), owner, owner.userId, T1)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    const r = inviteParticipant(
      discussingRequest(),
      owner,
      otherBuilder,
      "builder",
      T1,
    );
    expect(() => removeParticipant(r, builder, otherBuilder.userId, T1))
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
  });

  it("refuses people who aren't on the request", () => {
    expect(() => withdraw(discussingRequest(), stranger, "", T1))
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
  });
});
