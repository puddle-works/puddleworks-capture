import { DomainError } from "./errors.ts";
import type { SpecificationContent } from "./model.ts";

/** The acceptance criterion that holds the build to the requested phrase. */
export function requestedCriterion(
  phrase: string,
): { id: string; text: string } {
  return {
    id: "R1",
    text:
      `"${phrase}" is answered by a recipe, with no LLM call, as the recipe's examples describe.`,
  };
}

/** The draft a request starts with when a router raised it. */
export function startingSpec(
  phrase: string | undefined,
  candidateExtensions: string[],
): SpecificationContent {
  return {
    problemStatement: "",
    desiredOutcome: "",
    scope: { in: [], out: [] },
    constraints: [],
    assumptions: [],
    acceptanceCriteria: phrase === undefined
      ? []
      : [requestedCriterion(phrase)],
    recipe: {
      examples: phrase === undefined ? [] : [{ phrase, answer: "" }],
      pieces: [],
      whenEmpty: "",
      candidateExtensions,
    },
  };
}

/** What stops the recipe being proposed, in plain words. */
export function recipeProblems(
  content: SpecificationContent,
  requestedPhrase?: string,
): string[] {
  const problems: string[] = [];
  const examples = content.recipe?.examples ?? [];
  if (examples.length === 0) {
    problems.push(
      "The recipe has no examples: give at least one phrase it must answer, and what the answer shows.",
    );
  }
  for (const { phrase, answer } of examples) {
    if (!answer.trim()) problems.push(`The example "${phrase}" has no answer.`);
  }
  if (requestedPhrase === undefined) return problems;
  if (examples[0]?.phrase !== requestedPhrase) {
    problems.push(
      `The requested phrase "${requestedPhrase}" must be the recipe's first example, as it was asked.`,
    );
  }
  if (
    !content.acceptanceCriteria.some((c) => c.text.includes(requestedPhrase))
  ) {
    problems.push(
      `No acceptance criterion names the requested phrase "${requestedPhrase}".`,
    );
  }
  return problems;
}

/** An edit may add phrasings, but not reword or move the requested one. */
export function requirePhraseKept(
  content: SpecificationContent,
  requestedPhrase?: string,
): void {
  if (requestedPhrase === undefined) return;
  if (content.recipe?.examples[0]?.phrase !== requestedPhrase) {
    throw new DomainError(
      "invalid_input",
      `The requested phrase "${requestedPhrase}" must stay the recipe's first example, as it was asked.`,
    );
  }
}
