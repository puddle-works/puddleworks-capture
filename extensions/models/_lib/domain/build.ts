import type { BuildResultV1 } from "./build_result_v1.ts";
import { canonicalJson } from "./canonical.ts";
import { DomainError } from "./errors.ts";
import { applyTransition, statusWords } from "./lifecycle.ts";
import type {
  BuildResultRecord,
  ExampleCheck,
  Person,
  Request,
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

/**
 * Each example in the recipe the result was built from, against what the
 * result reported for it. Phrases the spec doesn't have are left out.
 */
export function exampleChecks(
  request: Request,
  result: BuildResultV1,
): ExampleCheck[] {
  const spec =
    request.specifications.find((s) => s.version === result.source?.version) ??
      latestAgreed(request);
  return (spec?.content.recipe?.examples ?? []).map(({ phrase }) => {
    const reported = result.examples?.find((e) => e.phrase === phrase);
    return {
      phrase,
      requested: phrase === request.requestedPhrase,
      outcome: !reported ? "missing" : reported.passed ? "passed" : "failed",
      detail: reported?.detail ?? null,
    };
  });
}

/** What stops this build being the release, in plain words. Empty means released. */
export function releaseProblems(
  request: Request,
  record: BuildResultRecord,
): string[] {
  const checks = exampleChecks(request, record.result);
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
  if (!record.result.published) problems.push("It isn't published yet.");
  return problems;
}

/**
 * Records what a build of the agreed version produced. The first moves the
 * request to building; it is released once the current build is published
 * and every example in the agreed recipe passed. A newer build that isn't
 * takes it back to building. The same result twice changes nothing.
 */
export function recordBuildResult(
  request: Request,
  actor: Person,
  result: BuildResultV1,
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
  const released =
    releaseProblems(recorded, currentBuild(recorded)!).length === 0;
  const to = released ? "released" : "building";
  if (to === request.status) return { ...recorded, updatedAt: at };
  return applyTransition(recorded, actor, released ? "release" : "build", at);
}
