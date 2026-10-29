import { describe, expect, it } from "./test_bdd.ts";
import {
  agree,
  allowedActions,
  currentBuild,
  editSpecification,
  exampleChecks,
  parseBuildResult,
  propose,
  recordBuildResult,
  recordExport,
  registryUrl,
  releaseProblems,
  type Request,
  revise,
  type SpecificationContent,
  upgradeRequest,
  withdraw,
} from "./index.ts";
import {
  agreedRequest,
  builder,
  buildResult,
  discussingRequest,
  goodSpec,
  owner,
  releasingResult,
  reviewer,
  T2,
} from "./test_fixtures.ts";

const T3 = "2026-10-23T13:00:00.000Z";

/** goodSpec with a second example, so one can pass and one fail. */
const twoExamples: SpecificationContent = {
  ...goodSpec,
  recipe: {
    ...goodSpec.recipe!,
    examples: [
      ...goodSpec.recipe!.examples,
      {
        phrase: "what should I order next week",
        answer: "The same, a week on.",
      },
    ],
  },
};

function agreedWith(
  content: SpecificationContent = twoExamples,
  requestedPhrase?: string,
): Request {
  let r = {
    ...discussingRequest(),
    ...(requestedPhrase !== undefined && { requestedPhrase }),
  };
  r = editSpecification(r, builder, content, [], T2);
  r = propose(r, builder, T2);
  return agree(r, owner, { version: 1, specHash: "hash-v1" }, T2);
}

describe("reading a build result", () => {
  it("reads one as the Factory writes it, ignoring fields Capture doesn't know", () => {
    const parsed = parseBuildResult({ ...releasingResult(), extra: true });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect("extra" in parsed.result).toBe(false);
  });

  it("says in plain words what is wrong with one that isn't", () => {
    expect(
      parseBuildResult({ ...buildResult(), apiVersion: "x", repository: "x" }),
    ).toEqual({
      ok: false,
      problems: [
        'apiVersion must be "puddleworks.dev/build-result/v1".',
        "repository: Invalid URL",
      ],
    });
  });

  it("takes only https links, since the page links to them", () => {
    const parsed = parseBuildResult(
      buildResult({ pullRequest: "javascript:alert(1)" }),
    );
    expect(parsed.ok).toBe(false);
  });
});

describe("recording a build result", () => {
  it("moves an agreed request to building, and keeps the result", () => {
    const r = recordBuildResult(agreedRequest(), builder, buildResult(), T3);
    expect(r.status).toBe("building");
    expect(r.transitions.at(-1)).toMatchObject({
      from: "agreed",
      to: "building",
      action: "build",
      by: builder.userId,
      at: T3,
    });
    expect(r.buildResults).toEqual([{
      specVersion: 1,
      recordedBy: builder.userId,
      recordedAt: T3,
      result: buildResult(),
    }]);
  });

  it("goes agreed → building → released as the results come in", () => {
    let r = recordBuildResult(agreedRequest(), builder, buildResult(), T3);
    r = recordBuildResult(r, builder, releasingResult(), T3);
    expect(r.status).toBe("released");
    expect(r.transitions.map((t) => `${t.from}->${t.to}:${t.action}`).slice(-2))
      .toEqual(["agreed->building:build", "building->released:release"]);
    expect(r.buildResults).toHaveLength(2);
  });

  it("releases straight from agreed when the first result is a passing release", () => {
    const r = recordBuildResult(agreedRequest(), owner, releasingResult(), T3);
    expect(r.status).toBe("released");
  });

  it("stays building while results come in, with no new transition", () => {
    let r = recordBuildResult(agreedRequest(), builder, buildResult(), T3);
    r = recordBuildResult(
      r,
      builder,
      buildResult({
        pullRequest: "https://github.com/example/stock-counts/pull/1",
        builtAt: "2026-10-23T11:00:00.000Z",
      }),
      T3,
    );
    expect(r.status).toBe("building");
    expect(r.transitions.filter((t) => t.action === "build")).toHaveLength(1);
    expect(r.updatedAt).toBe(T3);
  });

  it("lets the latest result win, by when it was built", () => {
    let r = recordBuildResult(agreedRequest(), builder, releasingResult(), T3);
    // Written before the release, but recorded after it.
    r = recordBuildResult(r, builder, buildResult(), T3);
    expect(r.status).toBe("released");
    expect(currentBuild(r)?.result.published?.version).toBe("2026.10.23.1");
    // A newer build that isn't released yet takes it back to building.
    r = recordBuildResult(
      r,
      builder,
      buildResult({ builtAt: "2026-10-24T09:00:00.000Z" }),
      T3,
    );
    expect(r.status).toBe("building");
    expect(r.transitions.at(-1)).toMatchObject({
      from: "released",
      to: "building",
    });
  });

  it("changes nothing when the same result is recorded again", () => {
    const r = recordBuildResult(agreedRequest(), builder, buildResult(), T3);
    expect(recordBuildResult(r, builder, buildResult(), T3)).toBe(r);
  });

  it("refuses a result for another version, or with another spec hash", () => {
    const r = agreedRequest();
    expect(() =>
      recordBuildResult(
        r,
        builder,
        buildResult({
          source: { url: "u", version: 2, specHash: "hash-v1" },
        }),
        T3,
      )
    ).toThrowError(expect.objectContaining({
      code: "invalid_state",
      message: "The build result is for version 2, but version 1 is agreed.",
    }));
    expect(() =>
      recordBuildResult(
        r,
        builder,
        buildResult({ source: { url: "u", version: 1, specHash: "other" } }),
        T3,
      )
    ).toThrowError(expect.objectContaining({
      code: "invalid_state",
      message:
        "The build result's spec hash isn't the one agreed for version 1, so it was built from something else.",
    }));
  });

  it("refuses a result with no version or spec hash to check", () => {
    expect(() =>
      recordBuildResult(
        agreedRequest(),
        builder,
        buildResult({ source: { url: "u" } }),
        T3,
      )
    ).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("refuses a request that isn't agreed, building or released", () => {
    expect(() =>
      recordBuildResult(discussingRequest(), builder, buildResult(), T3)
    ).toThrowError(expect.objectContaining({
      code: "invalid_state",
      message:
        "Can't record a build result for a request that is discussing; it must be agreed, building or released.",
    }));
  });

  it("lets only the outcome owner or a builder record one", () => {
    const r = agreedRequest();
    const withReviewer = {
      ...r,
      participants: [...r.participants, {
        userId: reviewer.userId,
        name: reviewer.name,
        email: reviewer.email,
        role: "reviewer" as const,
        invitedBy: owner.userId,
        joinedAt: T2,
      }],
    };
    expect(() => recordBuildResult(withReviewer, reviewer, buildResult(), T3))
      .toThrowError(expect.objectContaining({ code: "not_allowed" }));
  });
});

describe("released only when every example passes", () => {
  it("checks each example in the agreed spec against what was reported", () => {
    const r = agreedWith();
    const result = releasingResult({
      examples: [
        { phrase: "what should I order this week", passed: true },
        { phrase: "something not in the spec", passed: true },
      ],
    });
    expect(exampleChecks(r, result)).toEqual([
      {
        phrase: "what should I order this week",
        requested: false,
        outcome: "passed",
        detail: null,
      },
      {
        phrase: "what should I order next week",
        requested: false,
        outcome: "missing",
        detail: null,
      },
    ]);
  });

  it("stays building when an example fails or is missing, naming them", () => {
    const r = recordBuildResult(
      agreedWith(),
      builder,
      releasingResult({
        examples: [{
          phrase: "what should I order this week",
          passed: false,
          detail: "Answered for one week only.",
        }],
      }),
      T3,
    );
    expect(r.status).toBe("building");
    expect(releaseProblems(r, currentBuild(r)!)).toEqual([
      'The example "what should I order this week" failed: Answered for one week only.',
      'The example "what should I order next week" wasn\'t reported.',
    ]);
  });

  it("holds the requested phrase to it like any other example", () => {
    const phrase = "what should I order this week";
    const content = {
      ...twoExamples,
      acceptanceCriteria: [
        ...twoExamples.acceptanceCriteria,
        { id: "R1", text: `"${phrase}" is answered.` },
      ],
    };
    const r = recordBuildResult(
      agreedWith(content, phrase),
      builder,
      releasingResult({
        examples: [{ phrase: "what should I order next week", passed: true }],
      }),
      T3,
    );
    expect(r.status).toBe("building");
    expect(exampleChecks(r, currentBuild(r)!.result)[0]).toMatchObject({
      phrase,
      requested: true,
      outcome: "missing",
    });
    expect(releaseProblems(r, currentBuild(r)!)).toEqual([
      `The requested phrase "${phrase}" wasn't reported.`,
    ]);
  });

  it("isn't released before it is published, whatever the examples say", () => {
    const r = recordBuildResult(
      agreedRequest(),
      builder,
      releasingResult({ published: undefined }),
      T3,
    );
    expect(r.status).toBe("building");
    expect(releaseProblems(r, currentBuild(r)!)).toEqual([
      "It isn't published yet.",
    ]);
  });

  it("can't release a spec agreed before recipes, as it has no examples to check", () => {
    // Saved like that before recipes; it can't be proposed so any more.
    const agreed = agreedRequest();
    const old = {
      ...agreed,
      specifications: agreed.specifications.map((s) => {
        const { recipe: _, ...noRecipe } = s.content;
        return { ...s, content: noRecipe };
      }),
    };
    const r = recordBuildResult(
      old,
      builder,
      releasingResult(),
      T3,
    );
    expect(r.status).toBe("building");
    expect(releaseProblems(r, currentBuild(r)!)).toEqual([
      "The agreed spec has no recipe examples to check it against. Revise it to add a recipe.",
    ]);
  });
});

describe("after a build", () => {
  it("links a release to its registry page, named by its extension", () => {
    expect(registryUrl("@puddleworks/capture")).toBe(
      "https://swamp-club.com/extensions/@puddleworks/capture",
    );
  });

  it("revises from building or released, keeping the earlier results", () => {
    for (const result of [buildResult(), releasingResult()]) {
      const built = recordBuildResult(agreedRequest(), builder, result, T3);
      const r = revise(built, owner, T3);
      expect(r.status).toBe("discussing");
      expect(r.specifications.at(-1)).toMatchObject({
        version: 2,
        status: "draft",
      });
      expect(r.buildResults).toEqual(built.buildResults);
    }
  });

  it("refuses results for the old version once a new one is agreed", () => {
    let r = recordBuildResult(agreedRequest(), builder, releasingResult(), T3);
    r = revise(r, owner, T3);
    r = propose(r, builder, T3);
    r = agree(r, owner, { version: 2, specHash: "hash-v2" }, T3);
    expect(r.status).toBe("agreed");
    expect(currentBuild(r)).toBe(undefined);
    expect(() => recordBuildResult(r, builder, releasingResult(), T3))
      .toThrowError(expect.objectContaining({ code: "invalid_state" }));
  });

  it("can still be exported and withdrawn while building", () => {
    const r = recordBuildResult(agreedRequest(), builder, buildResult(), T3);
    expect(recordExport(r, builder, "markdown", T3).exports).toHaveLength(1);
    expect(withdraw(r, owner, "", T3).status).toBe("withdrawn");
  });

  it("offers recording a result, export and revise, but not the build steps themselves", () => {
    const r = recordBuildResult(agreedRequest(), builder, buildResult(), T3);
    expect(allowedActions(r, builder)).toEqual([
      "revise",
      "recordBuildResult",
      "export",
      "message",
      "invite",
    ]);
  });

  it("reads a request saved before build results as having none", () => {
    const { buildResults: _, ...old } = agreedRequest();
    expect(upgradeRequest(old as Request).buildResults).toEqual([]);
  });
});
