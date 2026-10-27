import { DomainError } from "./errors.ts";
import {
  type Person,
  type Request,
  type RequestStatus,
  TERMINAL_STATUSES,
} from "./model.ts";
import { type Permission, requirePermission } from "./permissions.ts";

export const ACTIONS = [
  "submit",
  "propose",
  "requestChanges",
  "agree",
  "export",
  "revise",
  "withdraw",
  "decline",
] as const;
export type Action = (typeof ACTIONS)[number];

export const TRANSITIONS: Record<
  Action,
  { from: readonly RequestStatus[]; to: RequestStatus }
> = {
  submit: { from: ["draft"], to: "discussing" },
  propose: { from: ["discussing"], to: "ready_for_agreement" },
  requestChanges: { from: ["ready_for_agreement"], to: "discussing" },
  agree: { from: ["ready_for_agreement"], to: "agreed" },
  export: { from: ["agreed", "exported"], to: "exported" },
  revise: { from: ["agreed", "exported"], to: "discussing" },
  withdraw: {
    from: ["draft", "discussing", "ready_for_agreement", "agreed", "exported"],
    to: "withdrawn",
  },
  decline: { from: ["discussing", "ready_for_agreement"], to: "declined" },
};

const PERMISSION_FOR: Record<Action, Permission | null> = {
  submit: null, // the outcome owner is the only participant of a draft
  propose: "propose",
  requestChanges: "requestChanges",
  agree: "agree",
  export: "export",
  revise: "revise",
  withdraw: "withdraw",
  decline: "decline",
};

const ACTION_WORDS: Record<Action, string> = {
  submit: "submit",
  propose: "propose the specification of",
  requestChanges: "ask for changes to",
  agree: "agree to",
  export: "export",
  revise: "revise",
  withdraw: "withdraw",
  decline: "decline",
};

export function statusWords(status: RequestStatus): string {
  return status.replaceAll("_", " ");
}

export function isClosed(request: Request): boolean {
  return TERMINAL_STATUSES.includes(request.status);
}

/** Checks the actor may take `action` now; throws not_allowed or invalid_state. */
export function checkTransition(
  request: Request,
  actor: Person,
  action: Action,
): void {
  const permission = PERMISSION_FOR[action];
  if (permission) {
    requirePermission(request, actor, permission);
  } else if (actor.userId !== request.outcomeOwnerId) {
    throw new DomainError("not_allowed", "Only the outcome owner can do that.");
  }
  const { from } = TRANSITIONS[action];
  if (!from.includes(request.status)) {
    throw new DomainError(
      "invalid_state",
      `Can't ${ACTION_WORDS[action]} a request that is ${
        statusWords(request.status)
      }; it must be ${from.map(statusWords).join(" or ")}.`,
    );
  }
}

/** Moves the request on and records who did it. Call checkTransition first. */
export function applyTransition(
  request: Request,
  actor: Person,
  action: Action,
  at: string,
  note: string | null = null,
): Request {
  const to = TRANSITIONS[action].to;
  return {
    ...request,
    status: to,
    updatedAt: at,
    transitions: [
      ...request.transitions,
      { from: request.status, to, action, by: actor.userId, at, note },
    ],
  };
}
