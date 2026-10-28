import { z } from "npm:zod@4.6.5";
import { openQuestions } from "./discussion.ts";
import { DomainError } from "./errors.ts";
import { type Request, ROLES, SpecificationContentSchema } from "./model.ts";
import { participantOf } from "./permissions.ts";
import { latestAgreed } from "./specification.ts";

/**
 * puddleworks.dev/outcome-spec/v1: what was agreed, by whom, in a form any
 * process can pick up. It says what success looks like, not how to build it.
 * An optional field may be added here, since readers ignore fields they
 * don't know; anything else needs a new version. Never change the meaning of
 * a field here.
 */
export const OUTCOME_SPEC_V1 = "puddleworks.dev/outcome-spec/v1";

const personSchema = z.object({ name: z.string(), email: z.string() });

export const OutcomeSpecV1Schema = z.object({
  format: z.literal(OUTCOME_SPEC_V1),
  request: z.object({
    id: z.string(),
    title: z.string(),
    initialDescription: z.string(),
    currentProcess: z.string(),
    /** The phrase the recipe must answer as asked, when a router raised it. */
    requestedPhrase: z.string().optional(),
    /** The request's page in Capture, where the discussion and agreement are. */
    url: z.url(),
  }),
  specification: SpecificationContentSchema.extend({
    version: z.number().int().positive(),
  }),
  agreement: z.object({
    agreedBy: personSchema,
    agreedAt: z.string(),
    specHash: z.string(),
  }),
  participants: z.array(personSchema.extend({ role: z.enum(ROLES) })),
  openQuestions: z.array(
    z.object({
      question: z.string(),
      askedBy: z.string(),
      askedAt: z.string(),
    }),
  ),
  exportedAt: z.string(),
});
export type OutcomeSpecV1 = z.infer<typeof OutcomeSpecV1Schema>;

export function toOutcomeSpecV1(
  request: Request,
  exportedAt: string,
  url: string,
): OutcomeSpecV1 {
  const spec = latestAgreed(request);
  const agreement = request.agreements.findLast((a) =>
    a.specVersion === spec?.version
  );
  if (!spec || !agreement) {
    throw new DomainError(
      "invalid_state",
      "Nothing has been agreed yet, so there is nothing to export.",
    );
  }
  const agreedBy = participantOf(request, agreement.agreedBy);
  return {
    format: OUTCOME_SPEC_V1,
    request: {
      id: request.id,
      title: request.title,
      initialDescription: request.initialDescription,
      currentProcess: request.currentProcess,
      ...(request.requestedPhrase !== undefined &&
        { requestedPhrase: request.requestedPhrase }),
      url,
    },
    specification: { version: spec.version, ...spec.content },
    agreement: {
      agreedBy: { name: agreedBy?.name ?? "", email: agreedBy?.email ?? "" },
      agreedAt: agreement.agreedAt,
      specHash: agreement.specHash,
    },
    participants: request.participants.map(({ role, name, email }) => ({
      role,
      name,
      email,
    })),
    openQuestions: openQuestions(request).map((m) => ({
      question: m.body,
      askedBy: m.authorName,
      askedAt: m.createdAt,
    })),
    exportedAt,
  };
}

const ROLE_LABELS = {
  outcome_owner: "outcome owner",
  builder: "builder",
  observer: "observer",
  reviewer: "reviewer",
} as const;

function bullets(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "None.";
}

/** One table cell: no line breaks, and a | that doesn't end the cell. */
function cell(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replaceAll("|", "\\|");
}

function recipeSection(doc: OutcomeSpecV1): string {
  const recipe = doc.specification.recipe;
  if (!recipe) return "None.";
  const phrase = doc.request.requestedPhrase;
  const rows = recipe.examples.map((e) =>
    `| ${cell(e.phrase)} | ${cell(e.answer)} |`
  );
  const pieces = recipe.pieces.map((p) => `${p.name} (${p.shape})`);
  return [
    phrase !== undefined && `Requested as: "${phrase}"`,
    ["| Phrase | Answer |", "| --- | --- |", ...rows].join("\n"),
    recipe.whenEmpty && `When there is nothing to show: ${recipe.whenEmpty}`,
    pieces.length > 0 && `Taken from the phrase: ${pieces.join(", ")}.`,
    recipe.candidateExtensions.length > 0 &&
    `Extensions to start from: ${recipe.candidateExtensions.join(", ")}.`,
  ].filter(Boolean).join("\n\n");
}

/** The same document as Markdown, for pasting into any process. */
export function toMarkdown(doc: OutcomeSpecV1): string {
  const s = doc.specification;
  const a = doc.agreement;
  const criteria = s.acceptanceCriteria.length
    ? s.acceptanceCriteria.map((c) => `- [ ] **${c.id}** ${c.text}`).join("\n")
    : "None.";
  const questions = bullets(
    doc.openQuestions.map((q) => `${q.question} (${q.askedBy})`),
  );
  const people = bullets(
    doc.participants.map((p) =>
      `${p.name} (${p.email}), ${ROLE_LABELS[p.role]}`
    ),
  );
  return [
    `# ${doc.request.title}`,
    `Outcome specification, version ${s.version}. Agreed by ${a.agreedBy.name} (${a.agreedBy.email}) on ${
      a.agreedAt.slice(0, 10)
    }.`,
    `## Problem\n\n${s.problemStatement}`,
    `## Desired outcome\n\n${s.desiredOutcome}`,
    `## In scope\n\n${bullets(s.scope.in)}`,
    `## Out of scope\n\n${bullets(s.scope.out)}`,
    `## Constraints\n\n${bullets(s.constraints)}`,
    `## Assumptions\n\n${bullets(s.assumptions)}`,
    `## Acceptance criteria\n\n${criteria}`,
    `## Recipe\n\n${recipeSection(doc)}`,
    `## Open questions\n\n${questions}`,
    `## How it is done today\n\n${
      doc.request.currentProcess || "Not described."
    }`,
    `## People\n\n${people}`,
    `---\n\n${doc.format} · [request ${doc.request.id}](${doc.request.url}) · spec hash ${a.specHash}`,
  ].join("\n\n") + "\n";
}
