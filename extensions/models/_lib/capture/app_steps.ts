// The steps the Capture app takes, each as one of the requests behavior's
// methods run as the person signed in to swamp serve. The app runs them
// through the @puddleworks/capture-app-step workflow, which names that person
// by the run's own login (run.initiatedBy), so nothing the app sends can say
// who acts. These are the steps the Slack app offers, with its guards.
import { type DiscussionPoint, DomainError } from "../domain/index.ts";
import { appBuildResultProblem } from "./build_result_input.ts";

export const APP_STEPS = [
  "whoami",
  "raise",
  "reply",
  "submit",
  "propose",
  "agree",
  "requestChanges",
  "withdraw",
  "join",
  "editSpecification",
  "recordBuildResult",
  "resolveQuestion",
] as const;
export type AppStep = (typeof APP_STEPS)[number];

/**
 * The steps a stand-in agent's turn follows, as in the Slack app, and the
 * discussion point each raises; null takes it from where the discussion is.
 * Submitting raises duplicates instead when the request may repeat another.
 */
export const STAND_IN_AFTER: Partial<Record<AppStep, DiscussionPoint | null>> =
  {
    reply: null,
    submit: "clarify",
    requestChanges: "proposal",
    editSpecification: null,
    resolveQuestion: null,
  };

/** What the app sends with a step; a workflow passes "" for what it leaves out. */
export interface AppStepInput {
  step: AppStep;
  id: string;
  version: number;
  note: string;
  reason: string;
  body: string;
  questionId: string;
  result: string;
  specification: string;
  title: string;
  description: string;
  currentProcess: string;
  phrase: string;
  idempotencyKey: string;
}

const refuse = (message: string): never => {
  throw new DomainError("invalid_input", message);
};

/** The method a step runs, and its inputs, acting as `as`. */
export function appStepCall(
  input: AppStepInput,
  as: string,
): { method: string; args: Record<string, unknown> } {
  const { step } = input;
  if (step === "whoami") refuse("whoami runs no method.");
  if (step === "raise") {
    return {
      method: "create_request",
      args: {
        as,
        title: input.title,
        description: input.description,
        currentProcess: input.currentProcess,
        phrase: input.phrase,
        // Each form sends its own key, so a retried step logs one request.
        ...(input.idempotencyKey && { idempotencyKey: input.idempotencyKey }),
      },
    };
  }
  if (!input.id) refuse("Say which request: its number or id.");
  const on = { as, id: input.id };
  switch (step) {
    case "reply":
      return {
        method: "post_message",
        args: { ...on, kind: "comment", body: input.body },
      };
    case "submit":
      return { method: "submit", args: on };
    case "propose":
      return { method: "propose", args: on };
    case "agree":
      // The version on screen, so a page left open can't agree to a newer one.
      if (!(input.version >= 1)) {
        refuse("Say which version you agree to, as shown on the request.");
      }
      return { method: "agree", args: { ...on, version: input.version } };
    case "requestChanges":
      return {
        method: "request_changes",
        args: { ...on, note: input.note },
      };
    case "withdraw":
      return { method: "withdraw", args: { ...on, reason: input.reason } };
    case "join":
      return { method: "join_request", args: on };
    case "editSpecification":
      return {
        method: "edit_specification",
        args: { ...on, specification: input.specification },
      };
    case "recordBuildResult": {
      const problem = appBuildResultProblem(input.result, input.id);
      if (problem) refuse(problem);
      // record_build_result finds the request from the result itself.
      return {
        method: "record_build_result",
        args: { as, result: input.result.trim() },
      };
    }
    case "resolveQuestion":
      if (!input.questionId) refuse("Say which question is answered.");
      return {
        method: "resolve_question",
        args: { ...on, questionId: input.questionId },
      };
  }
  return refuse(`${step} isn't a step the app takes.`);
}
