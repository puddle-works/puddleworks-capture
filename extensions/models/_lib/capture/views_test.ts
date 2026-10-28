// What the methods write and what the viewer is sent.
import { describe, expect, it } from "../domain/test_bdd.ts";
import { postMessage, removeParticipant } from "../domain/index.ts";
import {
  agreedRequest,
  builder,
  draftRequest,
  owner,
  stranger,
  T2,
} from "../domain/test_fixtures.ts";
import type { Stored } from "./ports.ts";
import {
  toRequestView,
  toSummary,
  toWebRequest,
  toWebSummary,
} from "./views.ts";

function stored(request = agreedRequest()): Stored {
  return {
    request,
    version: 3,
    idempotencyKeys: [{ userId: owner.userId, key: "k" }],
    before: null,
    legacy: null,
    number: 7,
  };
}

describe("method views", () => {
  it("summarise a request for the person asking, as the Capture API did", () => {
    expect(toSummary(stored(), builder)).toEqual({
      id: "r-1",
      number: 7,
      title: "Stock counts",
      status: "agreed",
      outcomeOwner: { userId: owner.userId, name: owner.name },
      yourRole: "builder",
      openQuestionCount: 0,
      createdAt: "2026-10-22T09:00:00.000Z",
      updatedAt: T2,
    });
    expect(toSummary(stored(), stranger).yourRole).toBe(null);
  });

  it("show a request with what the person may do now and the specification's ETag", () => {
    const view = toRequestView(stored(), owner);
    expect(view).toMatchObject({
      initialDescription: "We count stock every Friday.",
      specification: { version: 1, status: "agreed" },
      agreedVersion: 1,
      specificationEtag: `"v1-agreed-${T2}"`,
    });
    expect(view.allowedActions).toContain("revise");
    expect(view.participants).toHaveLength(2);
  });
});

describe("viewer views", () => {
  it("summarise every request without anyone's point of view", () => {
    expect(toWebSummary(stored())).toEqual({
      id: "r-1",
      number: 7,
      title: "Stock counts",
      status: "agreed",
      outcomeOwner: { userId: owner.userId, name: owner.name },
      participantCount: 2,
      openQuestionCount: 0,
      specificationVersion: 1,
      imported: false,
      createdAt: "2026-10-22T09:00:00.000Z",
      updatedAt: T2,
    });
  });

  it("show the whole request with names in place of ids, and no idempotency keys", () => {
    const view = toWebRequest(stored());
    expect(view.specifications[0]).toMatchObject({
      version: 1,
      status: "agreed",
      problems: [],
    });
    expect(view.agreements[0]).toMatchObject({
      agreedBy: { userId: owner.userId, name: owner.name },
    });
    expect(view.transitions.map((t) => t.byName)).toEqual([
      owner.name,
      builder.name,
      owner.name,
    ]);
    expect("idempotencyKeys" in view).toBe(false);
    expect(view.before).toBe(null);
  });

  it("show the requested phrase, and hold the spec's problems to it", () => {
    const phrase = "what needs counting this week";
    const view = toWebRequest(
      stored({ ...agreedRequest(), requestedPhrase: phrase }),
    );
    expect(view.requestedPhrase).toBe(phrase);
    expect(view.specifications[0].problems).toContain(
      `No acceptance criterion names the requested phrase "${phrase}".`,
    );
    expect(toWebRequest(stored()).requestedPhrase).toBe(null);
    expect(
      toRequestView(
        stored({ ...agreedRequest(), requestedPhrase: phrase }),
        owner,
      )
        .requestedPhrase,
    ).toBe(phrase);
  });

  it("give a request saved before numbers no number", () => {
    expect(toWebSummary({ ...stored(), number: null }).number).toBe(null);
  });

  it("name someone who has since left as a former participant", () => {
    const left = removeParticipant(agreedRequest(), owner, builder.userId, T2);
    const view = toWebRequest(stored(left));
    expect(view.specifications[0].createdByName).toBe("Former participant");
  });

  it("count open questions and mark an imported request", () => {
    const asked = postMessage(
      { ...draftRequest(), status: "discussing" },
      owner,
      { id: "m-1", kind: "question", body: "Which stockroom?" },
      T2,
    );
    const summary = toWebSummary({
      ...stored(asked),
      before: { name: "Old", state: "triaged", transitions: [] },
    });
    expect(summary).toMatchObject({
      openQuestionCount: 1,
      imported: true,
      specificationVersion: null,
    });
  });
});
