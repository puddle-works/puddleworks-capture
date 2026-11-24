import { describe, expect, it } from "./test_bdd.ts";
import {
  agree,
  allowedActions,
  closeAsDuplicate,
  createRequest,
  currentPoint,
  heldByOnePerson,
  inviteParticipant,
  joinAsBuilder,
  type Person,
  personPlays,
  postMessage,
  recordBuildResult,
  recordStandInTurn,
  type Request,
  requestChanges,
  type RequestStatus,
  requireStandInTurn,
  resolveQuestion,
  reviseSpecification,
  startBuilding,
  submit,
  withdraw,
} from "./index.ts";
import {
  builder,
  goodSpec,
  releasingResult,
  T0,
  T1,
  T2,
} from "./test_fixtures.ts";

/** Asks for an app and builds it themselves. */
const solo: Person = {
  userId: "u-solo",
  name: "Sol Solo",
  email: "sol@example.com",
  isBuilder: true,
};
const builderAgent: Person = {
  userId: "u-builder-agent",
  name: "Builder agent",
  email: "builder-agent@example.com",
  isBuilder: false,
  standIn: "builder",
};
const requesterAgent: Person = {
  userId: "u-requester-agent",
  name: "Requester agent",
  email: "requester-agent@example.com",
  isBuilder: false,
  standIn: "requester",
};
const people = [solo, builder, builderAgent, requesterAgent];
const T3 = "2026-10-22T12:00:00.000Z";
let ids = 0;
const newId = () => `m-${++ids}`;

function soloDiscussing(): Request {
  return submit(
    createRequest(
      {
        id: "r-1",
        title: "Stock counts",
        initialDescription: "We count stock every Friday.",
      },
      solo,
      T0,
    ),
    solo,
    T0,
  );
}

/** The builder agent drafted and proposed it; the person agreed and started. */
function soloBuilding(): Request {
  const proposed = recordStandInTurn(
    soloDiscussing(),
    builderAgent,
    {
      specification: goodSpec,
      propose: true,
    },
    { newId },
    T1,
  );
  const agreed = agree(proposed, solo, { version: 1, specHash: "h" }, T2);
  return startBuilding(agreed, solo, T2);
}

function refused(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return "allowed";
}

describe("stand-in agents", () => {
  it("has the person play the requester until Agreed, and the builder from Agreed on", () => {
    const plays = (s: RequestStatus) => personPlays(s, "clarify");
    expect(
      ["draft", "discussing", "ready_for_agreement"].map((s) =>
        plays(s as RequestStatus)
      ),
    ).toEqual(["requester", "requester", "requester"]);
    expect(
      ["agreed", "building", "released"].map((s) => plays(s as RequestStatus)),
    ).toEqual(["builder", "builder", "builder"]);
    // Duplicates and scope follow the phase like every other point.
    expect(personPlays("discussing", "duplicates")).toBe("requester");
    expect(personPlays("building", "duplicates")).toBe("builder");
  });

  it("gives the builder agent the turn before agreement, and not the requester agent", () => {
    const r = soloDiscussing();
    expect(
      refused(() => requireStandInTurn(r, people, builderAgent, "clarify")),
    ).toBe("allowed");
    expect(
      refused(() => requireStandInTurn(r, people, requesterAgent, "clarify")),
    ).toBe("not_allowed");
  });

  it("lets no agent join when the requester and the builder are different people", () => {
    const r = joinAsBuilder(soloDiscussing(), builder, T1);
    expect(heldByOnePerson(r, people)).toBe(false);
    for (const agent of [builderAgent, requesterAgent]) {
      expect(refused(() => requireStandInTurn(r, people, agent, "recipe")))
        .toBe("not_allowed");
    }
    // An owner who isn't a builder needs a builder, not a stand-in.
    const notBuilder = { ...solo, isBuilder: false };
    expect(heldByOnePerson(soloDiscussing(), [notBuilder])).toBe(false);
  });

  it("lets the builder agent draft and propose, joining as a builder", () => {
    const r = recordStandInTurn(
      soloDiscussing(),
      builderAgent,
      {
        messages: [{ kind: "comment", body: "Here is a first draft." }],
        specification: goodSpec,
        propose: true,
      },
      { newId },
      T1,
    );
    expect(r.status).toBe("ready_for_agreement");
    expect(r.participants.find((p) => p.userId === builderAgent.userId)?.role)
      .toBe("builder");
    // Its joining doesn't make it a second person.
    expect(heldByOnePerson(r, people)).toBe(true);
    expect(r.messages.map((m) => m.authorName)).toEqual(["Builder agent"]);
  });

  it("never lets an agent take a deciding step, even with the role for it", () => {
    const proposed = recordStandInTurn(
      soloDiscussing(),
      builderAgent,
      {
        specification: goodSpec,
        propose: true,
      },
      { newId },
      T1,
    );
    expect(
      refused(() =>
        agree(proposed, builderAgent, { version: 1, specHash: "h" }, T2)
      ),
    ).toBe("not_allowed");
    expect(refused(() => requestChanges(proposed, builderAgent, "", T2)))
      .toBe("not_allowed");
    expect(refused(() => withdraw(proposed, builderAgent, "", T2))).toBe(
      "not_allowed",
    );
    const other = { ...soloDiscussing(), id: "r-2" };
    expect(refused(() => closeAsDuplicate(proposed, other, builderAgent, T2)))
      .toBe("not_allowed");
    expect(refused(() =>
      postMessage(proposed, builderAgent, {
        id: "d",
        kind: "decision",
        body: "Agreed.",
      }, T2)
    )).toBe("not_allowed");
    const asked = postMessage(proposed, solo, {
      id: "q",
      kind: "question",
      body: "Which stockroom?",
    }, T2);
    expect(refused(() => resolveQuestion(asked, builderAgent, "q", null, T2)))
      .toBe("not_allowed");
    // Capture offers it none of those either.
    expect(allowedActions(proposed, builderAgent)).toEqual(["message"]);
  });

  it("gives the requester agent the turn while building, to talk but not to decide", () => {
    const r = soloBuilding();
    expect(
      refused(() => requireStandInTurn(r, people, builderAgent, "revision")),
    ).toBe("not_allowed");
    expect(
      refused(() => requireStandInTurn(r, people, requesterAgent, "revision")),
    ).toBe("allowed");
    const said = recordStandInTurn(
      r,
      requesterAgent,
      {
        messages: [{ kind: "comment", body: "That drifts from the request." }],
      },
      { newId },
      T3,
    );
    expect(said.messages.at(-1)?.authorName).toBe("Requester agent");
    expect(
      refused(() =>
        recordStandInTurn(r, requesterAgent, { specification: goodSpec }, {
          newId,
        }, T3)
      ),
    ).toBe("not_allowed");
    expect(
      refused(() =>
        recordBuildResult(said, requesterAgent, releasingResult(), T3)
      ),
    ).toBe("not_allowed");
  });

  it("has the requester agent challenge a revision raised while building", () => {
    const revised = reviseSpecification(soloBuilding(), solo, {
      content: { ...goodSpec, constraints: ["Two stockrooms"] },
      reason: "A second stockroom.",
      basedOnVersion: 1,
    }, T3);
    expect(revised.status).toBe("ready_for_agreement");
    expect(currentPoint(revised)).toBe("revision");
    expect(
      refused(() =>
        requireStandInTurn(revised, people, requesterAgent, "revision")
      ),
    ).toBe("allowed");
    expect(
      refused(() =>
        requireStandInTurn(revised, people, builderAgent, "revision")
      ),
    ).toBe("not_allowed");
    const challenged = recordStandInTurn(
      revised,
      requesterAgent,
      {
        messages: [{ kind: "question", body: "Was a second stockroom asked?" }],
      },
      { newId },
      T3,
    );
    expect(challenged.messages.at(-1)?.authorName).toBe("Requester agent");
    // Accepting it is still the person's.
    expect(
      refused(() =>
        agree(challenged, requesterAgent, { version: 2, specHash: "h" }, T3)
      ),
    ).toBe("not_allowed");
    // A first proposal, before any agreement, is still the builder agent's.
    expect(personPlays("ready_for_agreement", "proposal")).toBe("requester");
  });

  it("says a proposal the rules refuse as a comment, without losing what it said", () => {
    const asked = postMessage(soloDiscussing(), solo, {
      id: "q1",
      kind: "question",
      body: "Which stockroom?",
    }, T1);
    const r = recordStandInTurn(
      asked,
      builderAgent,
      {
        messages: [{ kind: "comment", body: "Draft attached." }],
        specification: goodSpec,
        propose: true,
      },
      { newId },
      T1,
    );
    expect(r.status).toBe("discussing");
    expect(r.specifications.at(-1)?.content.problemStatement).toBe(
      goodSpec.problemStatement,
    );
    expect(r.messages.at(-1)?.body).toContain("I couldn't propose it");
  });

  it("can't be handed a request, invited, or join on its own", () => {
    expect(
      refused(() =>
        createRequest(
          { id: "x", title: "t", initialDescription: "" },
          builderAgent,
          T0,
        )
      ),
    ).toBe("not_allowed");
    expect(refused(() => joinAsBuilder(soloDiscussing(), builderAgent, T1)))
      .toBe("not_allowed");
    // A draft has no discussion yet.
    const draft = createRequest(
      { id: "d", title: "t", initialDescription: "" },
      solo,
      T0,
    );
    expect(
      refused(() => requireStandInTurn(draft, people, builderAgent, "clarify")),
    ).toBe("invalid_state");
    expect(
      refused(() =>
        inviteParticipant(
          soloDiscussing(),
          solo,
          requesterAgent,
          "reviewer",
          T1,
        )
      ),
    ).toBe("not_allowed");
  });
});
