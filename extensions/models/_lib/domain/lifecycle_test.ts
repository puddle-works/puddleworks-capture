import { describe, expect, it } from "./test_bdd.ts";
import {
  ACTIONS,
  agree,
  decline,
  DomainError,
  recordExport,
  REQUEST_STATUSES,
  requestChanges,
  revise,
  submit,
  TERMINAL_STATUSES,
  TRANSITIONS,
  upgradeRequest,
  withdraw,
} from "./index.ts";
import type { Request } from "./model.ts";
import {
  agreedRequest,
  builder,
  discussingRequest,
  draftRequest,
  owner,
  readyRequest,
  T2,
} from "./test_fixtures.ts";

describe("transition table", () => {
  it("has exactly these edges", () => {
    const edges = ACTIONS.flatMap((a) =>
      TRANSITIONS[a].from.map((f) => `${f} -${a}-> ${TRANSITIONS[a].to}`)
    ).sort();
    expect(edges).toEqual([
      "agreed -build-> building",
      "agreed -release-> released",
      "agreed -revise-> discussing",
      "agreed -withdraw-> withdrawn",
      "building -release-> released",
      "building -revise-> discussing",
      "building -withdraw-> withdrawn",
      "discussing -decline-> declined",
      "discussing -propose-> ready_for_agreement",
      "discussing -withdraw-> withdrawn",
      "draft -submit-> discussing",
      "draft -withdraw-> withdrawn",
      "ready_for_agreement -agree-> agreed",
      "ready_for_agreement -decline-> declined",
      "ready_for_agreement -requestChanges-> discussing",
      "ready_for_agreement -withdraw-> withdrawn",
      "released -build-> building",
      "released -revise-> discussing",
    ]);
  });

  it("has no export step: agreeing is the hand-off", () => {
    expect(ACTIONS).not.toContain("export");
    expect(REQUEST_STATUSES).not.toContain("exported");
  });

  it("reaches every status from draft", () => {
    const seen = new Set(["draft"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const a of ACTIONS) {
        const t = TRANSITIONS[a];
        if (t.from.some((f) => seen.has(f)) && !seen.has(t.to)) {
          seen.add(t.to);
          grew = true;
        }
      }
    }
    expect([...seen].sort()).toEqual([...REQUEST_STATUSES].sort());
  });

  it("has no way out of a terminal status", () => {
    for (const a of ACTIONS) {
      for (const s of TERMINAL_STATUSES) {
        expect(TRANSITIONS[a].from).not.toContain(s);
      }
    }
  });
});

describe("primary journey", () => {
  it("goes draft → discussing → ready → agreed, and exporting moves nothing", () => {
    const r = recordExport(
      agreedRequest(),
      builder,
      "outcome-spec/v1+json",
      T2,
    );
    expect(r.status).toBe("agreed");
    expect(r.transitions.map((t) => `${t.from}->${t.to}:${t.action}`)).toEqual([
      "draft->discussing:submit",
      "discussing->ready_for_agreement:propose",
      "ready_for_agreement->agreed:agree",
    ]);
    expect(r.transitions[2]).toMatchObject({ by: owner.userId, at: T2 });
  });

  it("does not change the request it was given", () => {
    const before = draftRequest();
    const copy = structuredClone(before);
    submit(before, owner, T2);
    expect(before).toEqual(copy);
  });
});

describe("guards", () => {
  it("refuses an action from the wrong status", () => {
    expect(() =>
      agree(discussingRequest(), owner, { version: 1, specHash: "h" }, T2)
    )
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
  });

  it("refuses anything but reading once withdrawn", () => {
    const r = withdraw(discussingRequest(), owner, "No longer needed", T2);
    expect(r.status).toBe("withdrawn");
    expect(r.closedReason).toBe("No longer needed");
    expect(() => revise(r, owner, T2)).toThrowError(DomainError);
  });

  it("lets only the outcome owner withdraw", () => {
    expect(() => withdraw(discussingRequest(), builder, "", T2))
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
  });

  it("lets only a builder decline, with a reason", () => {
    expect(() => decline(discussingRequest(), owner, "x", T2))
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
    expect(() => decline(discussingRequest(), builder, "  ", T2))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    const r = decline(
      discussingRequest(),
      builder,
      "Manual work is fine here",
      T2,
    );
    expect(r.status).toBe("declined");
    expect(r.closedReason).toBe("Manual work is fine here");
  });

  it("asks for changes back to discussing", () => {
    const r = requestChanges(readyRequest(), owner, "Add a weekly total", T2);
    expect(r.status).toBe("discussing");
    expect(r.transitions.at(-1)?.note).toBe("Add a weekly total");
  });

  it("explains a refusal in plain words", () => {
    try {
      submit(discussingRequest(), owner, T2);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).message).toBe(
        "Can't submit a request that is discussing; it must be draft.",
      );
    }
  });
});

describe("a request saved before agreeing was the hand-off", () => {
  it("reads exported as agreed, in its status and its history, and keeps its exports", () => {
    const agreed = recordExport(agreedRequest(), builder, "markdown", T2);
    // As an older Capture saved it, with an export step.
    const old = {
      ...agreed,
      status: "exported",
      transitions: [...agreed.transitions, {
        from: "agreed",
        to: "exported",
        action: "export",
        by: builder.userId,
        at: T2,
        note: null,
      }],
    } as unknown as Request;
    const r = upgradeRequest(old);
    expect(r.status).toBe("agreed");
    expect(r.transitions.at(-1)).toMatchObject({
      from: "agreed",
      to: "agreed",
      action: "export",
    });
    expect(r.exports).toEqual(agreed.exports);
  });

  it("leaves any other request as it is", () => {
    const r = agreedRequest();
    expect(upgradeRequest(r)).toBe(r);
  });
});
