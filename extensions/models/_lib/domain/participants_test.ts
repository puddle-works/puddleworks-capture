import { describe, expect, it } from "./test_bdd.ts";
import {
  can,
  canRead,
  inviteParticipant,
  joinAsBuilder,
  removeParticipant,
  roleOf,
  submit,
  withdraw,
} from "./index.ts";
import {
  builder,
  colleague,
  discussingRequest,
  draftRequest,
  otherBuilder,
  owner,
  stranger,
  T1,
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
        agree: can("outcome_owner", "agree"),
        withdraw: can("outcome_owner", "withdraw"),
        decline: can("outcome_owner", "decline"),
        export: can("outcome_owner", "export"),
      },
      builder: {
        message: can("builder", "message"),
        editSpecification: can("builder", "editSpecification"),
        propose: can("builder", "propose"),
        agree: can("builder", "agree"),
        withdraw: can("builder", "withdraw"),
        decline: can("builder", "decline"),
        export: can("builder", "export"),
      },
      observer: {
        message: can("observer", "message"),
        editSpecification: can("observer", "editSpecification"),
        propose: can("observer", "propose"),
        agree: can("observer", "agree"),
        withdraw: can("observer", "withdraw"),
        decline: can("observer", "decline"),
        export: can("observer", "export"),
      },
    }).toEqual({
      outcome_owner: {
        message: true,
        editSpecification: true,
        propose: true,
        agree: true,
        withdraw: true,
        decline: false,
        export: true,
      },
      builder: {
        message: true,
        editSpecification: true,
        propose: true,
        agree: false,
        withdraw: false,
        decline: true,
        export: true,
      },
      observer: {
        message: false,
        editSpecification: false,
        propose: false,
        agree: false,
        withdraw: false,
        decline: false,
        export: false,
      },
    });
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

  it("lets a builder invite builders only, and observers invite nobody", () => {
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
