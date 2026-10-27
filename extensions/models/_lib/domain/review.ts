// An independent review of the frozen specification: an agent that never saw
// the discussion reads the version up for agreement and says what's missing,
// vague or untestable. Its findings become questions, so agreement waits for
// them.
import { z } from "npm:zod@4.6.5";
import { postMessage } from "./discussion.ts";
import { DomainError } from "./errors.ts";
import { statusWords } from "./lifecycle.ts";
import type { Person, Request } from "./model.ts";
import { roleOf } from "./permissions.ts";
import { latestSpecification, requestChanges } from "./specification.ts";

export const REVIEW_VERDICTS = [
  "ready",
  "minor_revision",
  "major_revision",
  "not_safe",
] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/** Verdicts that send the specification back for changes. */
const SENDS_BACK: readonly ReviewVerdict[] = ["major_revision", "not_safe"];

export const ReviewSchema = z.object({
  verdict: z.enum(REVIEW_VERDICTS),
  summary: z.string().trim().max(2_000).default(""),
  findings: z
    .array(z.object({
      id: z.string().trim().min(1).max(40),
      text: z.string().trim().min(1).max(10_000),
    }))
    .max(100)
    .refine(
      (fs) => new Set(fs.map((f) => f.id)).size === fs.length,
      "Each finding needs its own id.",
    ),
});
export type Review = z.input<typeof ReviewSchema>;

/** The specification up for agreement, when the person acting may review it. */
function underReview(request: Request, actor: Person) {
  if (roleOf(request, actor.userId) !== "reviewer") {
    throw new DomainError(
      "not_allowed",
      "Only a reviewer on this request can review it.",
    );
  }
  if (request.status !== "ready_for_agreement") {
    throw new DomainError(
      "invalid_state",
      `Can't review a request that is ${
        statusWords(request.status)
      }; it must be ready for agreement.`,
    );
  }
  return latestSpecification(request)!;
}

/**
 * Posts each finding as a question and the verdict as a decision. A major
 * revision, or a spec that isn't safe to build, also asks for changes.
 * `version`, when given, is the one reviewed, so a review of an older version
 * is refused.
 */
export function recordReview(
  request: Request,
  actor: Person,
  review: Review,
  { newId, version }: { newId: () => string; version?: number },
  at: string,
): Request {
  const spec = underReview(request, actor);
  if (version !== undefined && version !== spec.version) {
    throw new DomainError(
      "invalid_state",
      `Version ${version} isn't the one up for agreement; version ${spec.version} is.`,
    );
  }
  const parsed = ReviewSchema.safeParse(review);
  if (!parsed.success) {
    throw new DomainError(
      "invalid_input",
      `That isn't a review: ${
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" ")
      }`,
    );
  }
  const { verdict, summary, findings } = parsed.data;
  let next = request;
  for (const { id, text } of findings) {
    next = postMessage(next, actor, {
      id: newId(),
      kind: "question",
      body: `${id}: ${text}`,
    }, at);
  }
  const said = `Review of version ${spec.version}: ${
    verdict.replaceAll("_", " ")
  }. ${summary || (findings.length === 0 ? "No findings." : "")}`.trim();
  next = postMessage(next, actor, {
    id: newId(),
    kind: "decision",
    body: said,
  }, at);
  return SENDS_BACK.includes(verdict)
    ? requestChanges(next, actor, said, at)
    : next;
}

const bullets = (items: string[]) =>
  items.length === 0 ? "(none)" : items.map((s) => `- ${s}`).join("\n");

// The review criteria follow the work-item lens of @atalanta/sdlc-review-lenses
// (MIT, Copyright (c) 2026 Atalanta), rewritten for outcome-spec fields.
/** What the reviewer is asked: the frozen specification, and how to answer. */
export function reviewPrompt(request: Request): string {
  const spec = latestSpecification(request)!;
  const c = spec.content;
  return `You are reviewing an outcome specification before anyone agrees to it or builds from it. You have not seen the discussion that produced it; judge only what is written here.

Do not design the solution. Do not write a plan. Review only.

A good outcome specification says what is wanted, why, what done looks like and what must be respected. It does not say how to build it: no data shapes, algorithms, screens laid out field by field, libraries or file names, unless the requester truly needs one of those.

Check:
1. Altitude: does it say what, why and done, then stop? Flag design decisions that belong to the builder, and gaps where the builder would have to invent the requirement.
2. Consistency: do the problem, outcome, scope, constraints and criteria agree with each other, using the same words for the same things?
3. Scope: is it one coherent, small piece of work? Is what's out said where it matters? Flag phrases with no edge, such as "make it robust", "support X generally" or "improve handling".
4. Decisions: is every decision only the requester can make present (what users see, what an edge case does, what must not change)?
5. Acceptance criteria: can each one be checked by someone who wasn't there, giving a yes or no? Prefer "given X, Y happens" to "works well".
6. One reading: would ten builders understand the same outcome? Flag anything that could reasonably mean two different things.
7. Assumptions: are they stated, and would a wrong one change what is built?

Answer with one JSON object and nothing else:

{
  "verdict": "ready | minor_revision | major_revision | not_safe",
  "summary": "One sentence: your main judgement.",
  "findings": [
    { "id": "F1", "text": "What is missing, vague or untestable, which part of the spec it is in, and the smallest change that would fix it." }
  ]
}

- ready: a builder could start with no questions and would not have to invent a requirement. If in doubt, it isn't ready.
- minor_revision: small gaps that questions to the requester can settle.
- major_revision: the specification must be rewritten before it can be agreed.
- not_safe: building from it as written would build the wrong thing, or cause harm.

Number findings F1, F2 and so on. Each finding becomes a question the requester must answer before agreeing, so make each one a single, answerable point. Use an empty list when there is nothing to raise.

The specification

Request: ${request.title}
Specification version ${spec.version}

Problem statement:
${c.problemStatement}

Desired outcome:
${c.desiredOutcome}

In scope:
${bullets(c.scope.in)}

Out of scope:
${bullets(c.scope.out)}

Constraints:
${bullets(c.constraints)}

Assumptions:
${bullets(c.assumptions)}

Acceptance criteria:
${bullets(c.acceptanceCriteria.map((a) => `${a.id}: ${a.text}`))}
`;
}

/** Throws unless the person acting may review the request now; gives the version under review. */
export function reviewVersion(request: Request, actor: Person): number {
  return underReview(request, actor).version;
}
