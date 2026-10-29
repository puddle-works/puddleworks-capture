import { DomainError } from "./errors.ts";
import { applyTransition, checkTransition, isClosed } from "./lifecycle.ts";
import {
  type NewRequest,
  NewRequestSchema,
  type Person,
  type Request,
  type Role,
} from "./model.ts";
import { participantOf, requirePermission } from "./permissions.ts";
import { startingSpec } from "./recipe.ts";

/**
 * A draft owned by `owner`. A phrase, or the extensions a router found,
 * start the draft spec's recipe; the phrase becomes the requested phrase.
 */
export function createRequest(
  input: NewRequest,
  owner: Person,
  at: string,
): Request {
  const parsed = NewRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError(
      "invalid_input",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  const { phrase, candidateExtensions, ...fields } = parsed.data;
  const requestedPhrase = phrase || undefined;
  const starts = requestedPhrase !== undefined ||
    candidateExtensions.length > 0;
  return {
    ...fields,
    ...(requestedPhrase !== undefined && { requestedPhrase }),
    outcomeOwnerId: owner.userId,
    status: "draft",
    closedReason: null,
    participants: [
      {
        userId: owner.userId,
        name: owner.name,
        email: owner.email,
        role: "outcome_owner",
        invitedBy: null,
        joinedAt: at,
      },
    ],
    messages: [],
    specifications: starts
      ? [{
        version: 1,
        status: "draft",
        content: startingSpec(requestedPhrase, candidateExtensions),
        basedOnMessageIds: [],
        createdBy: owner.userId,
        createdAt: at,
        updatedAt: at,
      }]
      : [],
    agreements: [],
    exports: [],
    buildResults: [],
    transitions: [],
    createdAt: at,
    updatedAt: at,
  };
}

/** Fields left out (or undefined) stay as they are. */
export interface RequestDetails {
  title?: string | undefined;
  initialDescription?: string | undefined;
  currentProcess?: string | undefined;
}

const DetailsSchema = NewRequestSchema.pick({
  title: true,
  initialDescription: true,
  currentProcess: true,
}).partial();

/** The outcome owner changes the title, description or current process while it is still a draft. */
export function editDetails(
  request: Request,
  actor: Person,
  details: RequestDetails,
  at: string,
): Request {
  if (!participantOf(request, actor.userId)) {
    throw new DomainError("not_allowed", "You aren't part of this request.");
  }
  if (actor.userId !== request.outcomeOwnerId) {
    throw new DomainError(
      "not_allowed",
      "Only the outcome owner can change the request's details.",
    );
  }
  if (request.status !== "draft") {
    throw new DomainError(
      "invalid_state",
      "The details can only be changed before the request is submitted.",
    );
  }
  const parsed = DetailsSchema.safeParse(details);
  if (!parsed.success) {
    throw new DomainError(
      "invalid_input",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  const changes = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  );
  return { ...request, ...changes, updatedAt: at };
}

export function submit(request: Request, actor: Person, at: string): Request {
  checkTransition(request, actor, "submit");
  return applyTransition(request, actor, "submit", at);
}

export function withdraw(
  request: Request,
  actor: Person,
  reason: string,
  at: string,
): Request {
  checkTransition(request, actor, "withdraw");
  const note = reason.trim() || null;
  return {
    ...applyTransition(request, actor, "withdraw", at, note),
    closedReason: note,
  };
}

export function decline(
  request: Request,
  actor: Person,
  reason: string,
  at: string,
): Request {
  checkTransition(request, actor, "decline");
  const note = reason.trim();
  if (!note) {
    throw new DomainError(
      "invalid_input",
      "Say why you are declining, so the outcome owner knows.",
    );
  }
  return {
    ...applyTransition(request, actor, "decline", at, note),
    closedReason: note,
  };
}

export function requireOpen(request: Request, doing: string): void {
  if (request.status === "draft") {
    throw new DomainError(
      "invalid_state",
      `Submit the request before ${doing}.`,
    );
  }
  if (isClosed(request)) {
    throw new DomainError(
      "invalid_state",
      `The request is ${request.status}, so nobody can ${doing} now.`,
    );
  }
}

export function joinAsBuilder(
  request: Request,
  actor: Person,
  at: string,
): Request {
  if (!actor.isBuilder) {
    throw new DomainError("not_allowed", "Only builders can join a request.");
  }
  requireOpen(request, "joining");
  if (participantOf(request, actor.userId)) return request;
  return {
    ...request,
    updatedAt: at,
    participants: [
      ...request.participants,
      {
        userId: actor.userId,
        name: actor.name,
        email: actor.email,
        role: "builder",
        invitedBy: null,
        joinedAt: at,
      },
    ],
  };
}

export function inviteParticipant(
  request: Request,
  actor: Person,
  invitee: Person,
  role: Exclude<Role, "outcome_owner">,
  at: string,
): Request {
  const actorRole = requirePermission(request, actor, "invite");
  if (actorRole === "builder" && role === "observer") {
    throw new DomainError(
      "not_allowed",
      "As a builder you can invite builders and reviewers only.",
    );
  }
  requireOpen(request, "inviting people");
  if (participantOf(request, invitee.userId)) {
    throw new DomainError(
      "invalid_state",
      `${invitee.name} is already part of this request.`,
    );
  }
  if (role === "builder" && !invitee.isBuilder) {
    throw new DomainError(
      "invalid_input",
      `${invitee.name} isn't a builder; invite them as an observer or a reviewer.`,
    );
  }
  return {
    ...request,
    updatedAt: at,
    participants: [
      ...request.participants,
      {
        userId: invitee.userId,
        name: invitee.name,
        email: invitee.email,
        role,
        invitedBy: actor.userId,
        joinedAt: at,
      },
    ],
  };
}

/** The outcome owner removes someone, or anyone else leaves. */
export function removeParticipant(
  request: Request,
  actor: Person,
  userId: string,
  at: string,
): Request {
  if (!participantOf(request, actor.userId)) {
    throw new DomainError("not_allowed", "You aren't part of this request.");
  }
  if (userId === request.outcomeOwnerId) {
    throw new DomainError(
      "invalid_input",
      "The outcome owner can't be removed.",
    );
  }
  if (userId !== actor.userId) {
    requirePermission(request, actor, "removeParticipant");
  }
  if (!participantOf(request, userId)) {
    throw new DomainError(
      "not_found",
      "That person isn't part of this request.",
    );
  }
  return {
    ...request,
    updatedAt: at,
    participants: request.participants.filter((p) => p.userId !== userId),
  };
}
