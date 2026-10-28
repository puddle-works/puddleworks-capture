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
  revise: { from: ["agreed"], to: "discussing" },
  withdraw: {
    from: ["draft", "discussing", "ready_for_agreement", "agreed"],
    to: "withdrawn",
  },
  decline: { from: ["discussing", "ready_for_agreement"], to: "declined" },
};

const PERMISSION_FOR: Record<Action, Permission | null> = {
  submit: null, // the outcome owner is the only participant of a draft
  propose: "propose",
  requestChanges: "requestChanges",
  agree: "agree",
  revise: "revise",
  withdraw: "withdraw",
  decline: "decline",
};

const ACTION_WORDS: Record<Action, string> = {
  submit: "submit",
  propose: "propose the specification of",
  requestChanges: "ask for changes to",
  agree: "agree to",
  revise: "revise",
  withdraw: "withdraw",
  decline: "decline",
};

/**
 * A request as an older Capture saved it, brought up to date. Exporting once
 * moved an agreed request to `exported`; agreeing is now the hand-off, so
 * `exported` reads as `agreed`, in the status and in the history. Its exports
 * stay as they were.
 */
export function upgradeRequest(request: Request): Request {
  const was = (s: string) => (s === "exported" ? "agreed" : s) as RequestStatus;
  const old = (s: string) => s === "exported";
  if (
    !old(request.status) &&
    !request.transitions.some((t) => old(t.from) || old(t.to))
  ) {
    return request;
  }
  return {
    ...request,
    status: was(request.status),
    transitions: request.transitions.map((t) => ({
      ...t,
      from: was(t.from),
      to: was(t.to),
    })),
  };
}

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
