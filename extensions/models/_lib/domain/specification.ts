import { openQuestions } from "./discussion.ts";
import { DomainError } from "./errors.ts";
import { applyTransition, checkTransition, statusWords } from "./lifecycle.ts";
import {
  type ExportFormat,
  type Person,
  type Request,
  type RequestStatus,
  type SpecificationContent,
  SpecificationContentSchema,
  type SpecificationVersion,
} from "./model.ts";
import { requirePermission } from "./permissions.ts";
import { recipeProblems, requirePhraseKept } from "./recipe.ts";

/**
 * What stops a draft being proposed, in plain words. Empty means ready.
 * `requestedPhrase` is the request's, which the recipe must keep.
 */
export function specificationProblems(
  content: SpecificationContent,
  requestedPhrase?: string,
): string[] {
  const problems: string[] = [];
  if (!content.problemStatement.trim()) {
    problems.push("Problem statement is empty.");
  }
  if (!content.desiredOutcome.trim()) {
    problems.push("Desired outcome is empty.");
  }
  if (!content.scope.in.some((s) => s.trim())) {
    problems.push("Nothing is in scope.");
  }
  if (content.acceptanceCriteria.length === 0) {
    problems.push("There are no acceptance criteria.");
  }
  const seen = new Set<string>();
  for (const { id } of content.acceptanceCriteria) {
    if (seen.has(id)) {
      problems.push(`Acceptance criterion ${id} appears more than once.`);
    }
    seen.add(id);
  }
  for (const { id, text } of content.acceptanceCriteria) {
    if (!text.trim()) problems.push(`Acceptance criterion ${id} has no text.`);
  }
  return [...problems, ...recipeProblems(content, requestedPhrase)];
}

/** Agreeing, or proposing, waits until every question has an answer. */
export function requireNoOpenQuestions(request: Request): void {
  const open = openQuestions(request);
  if (open.length > 0) {
    throw new DomainError(
      "invalid_state",
      `Resolve the ${
        open.length === 1 ? "open question" : `${open.length} open questions`
      } first.`,
    );
  }
}

export function latestSpecification(
  request: Request,
): SpecificationVersion | undefined {
  return request.specifications.at(-1);
}

/** The statuses with an agreed version standing, to export or build from. */
export const BUILT_FROM_AGREED: readonly RequestStatus[] = [
  "agreed",
  "building",
  "released",
];

export function latestAgreed(
  request: Request,
): SpecificationVersion | undefined {
  return request.specifications.findLast((s) => s.status === "agreed");
}

function replaceLatest(
  request: Request,
  spec: SpecificationVersion,
): SpecificationVersion[] {
  return [...request.specifications.slice(0, -1), spec];
}

/**
 * Saves the draft: edits the latest draft version, or starts the next one.
 * Content with no recipe keeps the one the latest version has.
 */
export function editSpecification(
  request: Request,
  actor: Person,
  content: SpecificationContent,
  basedOnMessageIds: string[],
  at: string,
): Request {
  requirePermission(request, actor, "editSpecification");
  if (request.status !== "draft" && request.status !== "discussing") {
    throw new DomainError(
      "invalid_state",
      "The specification can only be edited while the request is a draft or being discussed.",
    );
  }
  const parsed = SpecificationContentSchema.safeParse(content);
  if (!parsed.success) {
    throw new DomainError(
      "invalid_input",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(
        " ",
      ),
    );
  }
  const latest = latestSpecification(request);
  const recipe = parsed.data.recipe ?? latest?.content.recipe;
  const edited = recipe ? { ...parsed.data, recipe } : parsed.data;
  requirePhraseKept(edited, request.requestedPhrase);
  if (latest?.status === "draft") {
    return {
      ...request,
      updatedAt: at,
      specifications: replaceLatest(request, {
        ...latest,
        content: edited,
        basedOnMessageIds,
        updatedAt: at,
      }),
    };
  }
  const next: SpecificationVersion = {
    version: (latest?.version ?? 0) + 1,
    status: "draft",
    content: edited,
    basedOnMessageIds,
    createdBy: actor.userId,
    createdAt: at,
    updatedAt: at,
  };
  return {
    ...request,
    updatedAt: at,
    specifications: [...request.specifications, next],
  };
}

export function propose(request: Request, actor: Person, at: string): Request {
  checkTransition(request, actor, "propose");
  const latest = latestSpecification(request);
  if (latest?.status !== "draft") {
    throw new DomainError(
      "invalid_state",
      "There is no draft specification to propose.",
    );
  }
  const problems = specificationProblems(
    latest.content,
    request.requestedPhrase,
  );
  if (problems.length > 0) {
    throw new DomainError(
      "invalid_state",
      `The specification isn't ready: ${problems.join(" ")}`,
    );
  }
  requireNoOpenQuestions(request);
  const moved = applyTransition(request, actor, "propose", at);
  return {
    ...moved,
    specifications: replaceLatest(request, {
      ...latest,
      status: "proposed",
      updatedAt: at,
    }),
  };
}

export function requestChanges(
  request: Request,
  actor: Person,
  note: string,
  at: string,
): Request {
  checkTransition(request, actor, "requestChanges");
  const latest = latestSpecification(request)!;
  const moved = applyTransition(
    request,
    actor,
    "requestChanges",
    at,
    note.trim() || null,
  );
  return {
    ...moved,
    specifications: replaceLatest(request, {
      ...latest,
      status: "changes_requested",
      updatedAt: at,
    }),
  };
}

/**
 * The outcome owner agrees to the proposed version. `version` is the one they
 * were shown, so a stale screen can't agree to something else.
 */
export function agree(
  request: Request,
  actor: Person,
  { version, specHash }: { version: number; specHash: string },
  at: string,
): Request {
  checkTransition(request, actor, "agree");
  const proposed = latestSpecification(request)!;
  if (proposed.version !== version) {
    throw new DomainError(
      "invalid_state",
      `Version ${version} isn't the one up for agreement; version ${proposed.version} is.`,
    );
  }
  if (!specHash) {
    throw new DomainError(
      "invalid_input",
      "The specification hash is missing.",
    );
  }
  requireNoOpenQuestions(request);
  const moved = applyTransition(request, actor, "agree", at);
  return {
    ...moved,
    specifications: request.specifications.map((s) => {
      if (s.version === version) {
        return { ...s, status: "agreed", updatedAt: at };
      }
      if (s.status === "agreed") {
        return { ...s, status: "superseded", updatedAt: at };
      }
      return s;
    }),
    agreements: [...request.agreements, {
      specVersion: version,
      agreedBy: actor.userId,
      agreedAt: at,
      specHash,
    }],
  };
}

export function recordExport(
  request: Request,
  actor: Person,
  format: ExportFormat,
  at: string,
): Request {
  requirePermission(request, actor, "export");
  if (!BUILT_FROM_AGREED.includes(request.status)) {
    throw new DomainError(
      "invalid_state",
      `Can't export a request that is ${
        statusWords(request.status)
      }; it must be agreed, building or released.`,
    );
  }
  const agreed = latestAgreed(request)!;
  return {
    ...request,
    updatedAt: at,
    exports: [...request.exports, {
      specVersion: agreed.version,
      format,
      exportedBy: actor.userId,
      exportedAt: at,
    }],
  };
}

/** Opens a new draft from the agreed version. The old agreement stands until a new one replaces it. */
export function revise(request: Request, actor: Person, at: string): Request {
  checkTransition(request, actor, "revise");
  const agreed = latestAgreed(request)!;
  const next: SpecificationVersion = {
    version: latestSpecification(request)!.version + 1,
    status: "draft",
    content: structuredClone(agreed.content),
    basedOnMessageIds: [],
    createdBy: actor.userId,
    createdAt: at,
    updatedAt: at,
  };
  return {
    ...applyTransition(request, actor, "revise", at),
    specifications: [...request.specifications, next],
  };
}
