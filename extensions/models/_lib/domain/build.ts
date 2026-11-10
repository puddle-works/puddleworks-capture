import { BUILD_RESULT_V1, type BuildResult } from "./build_result.ts";
import { canonicalJson } from "./canonical.ts";
import { DomainError } from "./errors.ts";
import { applyTransition, statusWords } from "./lifecycle.ts";
import type {
  BuildResultRecord,
  ExampleCheck,
  Person,
  Request,
  RouterTest,
  RouterTestOutcome,
} from "./model.ts";
import { requirePermission } from "./permissions.ts";
import { BUILT_FROM_AGREED, latestAgreed } from "./specification.ts";

/** The extension's page on the swamp registry. */
export function registryUrl(extension: string): string {
  return `https://swamp-club.com/extensions/${extension}`;
}

/**
 * The build that stands for the agreed version: the one built last, or
 * recorded last when two were built at once. None once a new version is
 * agreed, until something is built from it.
 */
export function currentBuild(request: Request): BuildResultRecord | undefined {
  const agreed = latestAgreed(request);
  if (!agreed) return undefined;
  let current: BuildResultRecord | undefined;
  for (const record of request.buildResults) {
    if (record.specVersion !== agreed.version) continue;
    if (!current || record.result.builtAt >= current.result.builtAt) {
      current = record;
    }
  }
  return current;
}

/** The agreed spec a result was built from. */
function builtFrom(request: Request, result: BuildResult) {
  return request.specifications.find((s) =>
    s.version === result.source?.version
  ) ?? latestAgreed(request);
}

/**
 * The outcome owner's latest router test of a version: the one that counts,
 * as each new test replaces the last.
 */
export function routerTestFor(
  request: Request,
  version: string | undefined,
): RouterTest | undefined {
  if (version === undefined) return undefined;
  return (request.routerTests ?? []).findLast((t) => t.version === version);
}

/**
 * Each example in the recipe the result was built from, against what the
 * result reported for it and what the outcome owner's router test of its
 * published version said. Phrases the spec doesn't have are left out.
 */
export function exampleChecks(
  request: Request,
  result: BuildResult,
): ExampleCheck[] {
  const test = routerTestFor(request, result.published?.version);
  return (builtFrom(request, result)?.content.recipe?.examples ?? []).map(
    ({ phrase }) => {
      const reported = result.examples?.find((e) => e.phrase === phrase);
      const tested = test?.results.find((t) => t.phrase === phrase);
      const v1 = result.apiVersion === BUILD_RESULT_V1
        ? result.examples?.find((e) => e.phrase === phrase)
        : undefined;
      return {
        phrase,
        requested: phrase === request.requestedPhrase,
        outcome: !reported ? "missing" : reported.passed ? "passed" : "failed",
        detail: reported?.detail ?? null,
        routerTest: tested
          ? {
            outcome: tested.outcome,
            note: tested.note,
            recordedAt: test!.recordedAt,
          }
          : null,
        recipeId: v1?.recipeId ?? null,
        router: v1?.router ?? null,
      };
    },
  );
}

/** What the outcome owner's router test says against one example, in plain words. */
function routerProblem(
  { phrase, routerTest }: ExampleCheck,
  version: string,
): string[] {
  if (!routerTest) {
    return [
      `The example "${phrase}" hasn't been sent through puddlerouter with version ${version}.`,
    ];
  }
  if (routerTest.outcome === "not-answered") {
    return [
      `The example "${phrase}" wasn't answered through puddlerouter${
        routerTest.note ? `: ${routerTest.note}` : "."
      }`,
    ];
  }
  return [];
}

/**
 * What stops this build being the release, in plain words. Empty means
 * released. The builder's checks must pass; the published recipe must have
 * every agreed phrase as written and the agreed answer when there is nothing
 * to show; and the outcome owner must have sent every phrase through
 * puddlerouter with the published version and had it answered.
 */
export function releaseProblems(
  request: Request,
  record: BuildResultRecord,
): string[] {
  const { result } = record;
  const checks = exampleChecks(request, result);
  const problems: string[] = checks.length === 0
    ? [
      "The agreed spec has no recipe examples to check it against. Revise it to add a recipe.",
    ]
    : checks.flatMap(({ phrase, requested, outcome, detail }) => {
      if (outcome === "failed") {
        return [
          `The example "${phrase}" failed${detail ? `: ${detail}` : "."}`,
        ];
      }
      if (outcome === "missing") {
        return [
          requested
            ? `The requested phrase "${phrase}" wasn't reported.`
            : `The example "${phrase}" wasn't reported.`,
        ];
      }
      return [];
    });
  const whenEmpty = builtFrom(request, result)?.content.recipe?.whenEmpty
    .trim() ?? "";
  if (checks.length > 0 && !whenEmpty) {
    problems.push(
      "Say what the answer is when there is nothing to show. Revise the spec to add it.",
    );
  }
  if (!result.published) {
    problems.push("It isn't published yet.");
    return problems;
  }
  const recipe = result.apiVersion === BUILD_RESULT_V1
    ? undefined
    : result.recipe;
  if (!recipe) {
    problems.push(
      result.apiVersion === BUILD_RESULT_V1
        ? "It is a build-result/v1, which doesn't carry the published recipe. Record a build-result/v2."
        : "The build result doesn't carry the published recipe.",
    );
  } else {
    for (const { phrase } of checks) {
      if (!recipe.phrases.includes(phrase)) {
        problems.push(
          `The published recipe doesn't have the example "${phrase}" as written.`,
        );
      }
    }
    if (whenEmpty && recipe.empty !== whenEmpty) {
      problems.push(
        `The published recipe answers "${recipe.empty}" when there is nothing to show, not the agreed "${whenEmpty}".`,
      );
    }
  }
  problems.push(
    ...checks.flatMap((c) => routerProblem(c, result.published!.version)),
  );
  return problems;
}

/** Released when the current build has nothing stopping it; building otherwise. */
function settle(before: Request, after: Request, actor: Person, at: string) {
  const current = currentBuild(after);
  const released = !!current && releaseProblems(after, current).length === 0;
  const to = released ? "released" : "building";
  if (to === before.status) return { ...after, updatedAt: at };
  return applyTransition(after, actor, released ? "release" : "build", at);
}

/**
 * Starts building an agreed request, before any build result: it moves to
 * building, so the person who asked can see work has begun. Results recorded
 * after that keep it there until one is released. A released request isn't
 * started again; a newer unreleased result takes it back to building.
 */
export function startBuilding(
  request: Request,
  actor: Person,
  at: string,
): Request {
  requirePermission(request, actor, "startBuilding");
  if (request.status !== "agreed") {
    throw new DomainError(
      "invalid_state",
      `Can't start building a request that is ${
        statusWords(request.status)
      }; it must be agreed.`,
    );
  }
  return applyTransition(request, actor, "build", at);
}

/**
 * Records what a build of the agreed version produced. The first moves the
 * request to building, unless it already was; it is released once the
 * current build is published and every example in the agreed recipe passed. A
 * newer build that isn't takes it back to building. The same result twice
 * changes nothing.
 */
export function recordBuildResult(
  request: Request,
  actor: Person,
  result: BuildResult,
  at: string,
): Request {
  requirePermission(request, actor, "recordBuildResult");
  if (!BUILT_FROM_AGREED.includes(request.status)) {
    throw new DomainError(
      "invalid_state",
      `Can't record a build result for a request that is ${
        statusWords(request.status)
      }; it must be agreed, building or released.`,
    );
  }
  const agreed = latestAgreed(request)!;
  const { version, specHash } = result.source ?? {};
  if (version === undefined || specHash === undefined) {
    throw new DomainError(
      "invalid_input",
      "The build result doesn't say which version and spec hash it was built from, so Capture can't check it was built from what was agreed.",
    );
  }
  if (version !== agreed.version) {
    throw new DomainError(
      "invalid_state",
      `The build result is for version ${version}, but version ${agreed.version} is agreed.`,
    );
  }
  const agreement = request.agreements.findLast((a) =>
    a.specVersion === agreed.version
  );
  if (specHash !== agreement?.specHash) {
    throw new DomainError(
      "invalid_state",
      `The build result's spec hash isn't the one agreed for version ${agreed.version}, so it was built from something else.`,
    );
  }
  const same = canonicalJson(result);
  if (
    request.buildResults.some((r) =>
      r.specVersion === version && canonicalJson(r.result) === same
    )
  ) {
    return request;
  }
  const recorded: Request = {
    ...request,
    buildResults: [...request.buildResults, {
      specVersion: version,
      recordedBy: actor.userId,
      recordedAt: at,
      result,
    }],
  };
  return settle(request, recorded, actor, at);
}

/**
 * Records the outcome owner sending the agreed phrases through puddlerouter
 * on their own desk, with the current build's published version installed.
 * It replaces their last test of that version, and releases the request
 * once nothing else stops it; a test that no longer passes takes a released
 * request back to building.
 */
export function recordRouterTest(
  request: Request,
  actor: Person,
  test: {
    version: string;
    results: { phrase: string; outcome: RouterTestOutcome; note?: string }[];
  },
  at: string,
): Request {
  requirePermission(request, actor, "recordRouterTest");
  const current = currentBuild(request);
  if (
    (request.status !== "building" && request.status !== "released") ||
    !current?.result.published
  ) {
    throw new DomainError(
      "invalid_state",
      "There is no published build of the agreed version to send through puddlerouter yet.",
    );
  }
  const published = current.result.published.version;
  if (test.version !== published) {
    throw new DomainError(
      "invalid_input",
      `The current build published version ${published}; test that version, not ${test.version}.`,
    );
  }
  const agreed = (builtFrom(request, current.result)?.content.recipe
    ?.examples ?? []).map((e) => e.phrase);
  const seen = new Set<string>();
  for (const { phrase } of test.results) {
    if (!agreed.includes(phrase)) {
      throw new DomainError(
        "invalid_input",
        `"${phrase}" isn't one of the agreed examples.`,
      );
    }
    if (seen.has(phrase)) {
      throw new DomainError(
        "invalid_input",
        `"${phrase}" is in the test twice.`,
      );
    }
    seen.add(phrase);
  }
  const recorded: Request = {
    ...request,
    routerTests: [...(request.routerTests ?? []), {
      version: test.version,
      results: test.results.map(({ phrase, outcome, note }) => ({
        phrase,
        outcome,
        note: note?.trim() || null,
      })),
      recordedBy: actor.userId,
      recordedAt: at,
    }],
  };
  return settle(request, recorded, actor, at);
}
