import { DomainError } from "./errors.ts";
import { applyTransition, checkTransition, isClosed } from "./lifecycle.ts";
import {
  type LoggedBy,
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
 * `loggedBy` is who logged it for the owner, when that was someone else.
 */
export function createRequest(
  input: NewRequest,
  owner: Person,
  at: string,
  loggedBy?: LoggedBy,
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
    ...(loggedBy && loggedBy.userId !== owner.userId && { loggedBy }),
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

/** While the details can change: the same states as the specification. */
const DETAILS_EDITABLE: readonly Request["status"][] = ["draft", "discussing"];

export function canEditDetails(request: Request): boolean {
  return DETAILS_EDITABLE.includes(request.status);
}

/**
 * The outcome owner changes the title, description or current process while
 * the request is a draft or being discussed. Once submitted, each change is
 * recorded in the history, saying what changed.
 */
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
  if (!canEditDetails(request)) {
    throw new DomainError(
      "invalid_state",
      "The details can only be changed while the request is a draft or being discussed.",
    );
  }
  const parsed = DetailsSchema.safeParse(details);
  if (!parsed.success) {
    throw new DomainError(
      "invalid_input",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  // Only the fields given: the schema's defaults would blank the others.
  const changes = Object.fromEntries(
    Object.entries(parsed.data).filter(([k]) =>
      details[k as keyof RequestDetails] !== undefined
    ),
  );
  const changed = { ...request, ...changes, updatedAt: at };
  const note = detailsNote(request, changed);
  if (request.status === "draft" || note === null) return changed;
  return {
    ...changed,
    transitions: [...request.transitions, {
      from: request.status,
      to: request.status,
      action: "editDetails",
      by: actor.userId,
      at,
      note,
    }],
  };
}

/** What changed between two versions of the details, or null for nothing. */
function detailsNote(before: Request, after: Request): string | null {
  const notes = [
    before.title !== after.title && `Title was "${before.title}".`,
    before.initialDescription !== after.initialDescription &&
    "The description changed.",
    before.currentProcess !== after.currentProcess &&
    "The current process changed.",
  ].filter((n) => n !== false);
  return notes.length > 0 ? notes.join(" ") : null;
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

/**
 * The outcome owner hands the request to someone else in the people list,
 * such as the person who asked for a request a bot logged. The new owner
 * takes over every outcome owner's step; the old one stays on as an
 * observer, so they can still read it, until someone takes them off.
 */
export function transferOwnership(
  request: Request,
  actor: Person,
  to: Person,
  at: string,
): Request {
  if (!participantOf(request, actor.userId)) {
    throw new DomainError("not_allowed", "You aren't part of this request.");
  }
  if (actor.userId !== request.outcomeOwnerId) {
    throw new DomainError(
      "not_allowed",
      "Only the outcome owner can hand the request to someone else.",
    );
  }
  if (isClosed(request)) {
    throw new DomainError(
      "invalid_state",
      `The request is ${request.status}, so its outcome owner can't change.`,
    );
  }
  if (to.userId === request.outcomeOwnerId) {
    throw new DomainError(
      "invalid_input",
      `${to.name} is already the outcome owner.`,
    );
  }
  const from = participantOf(request, request.outcomeOwnerId)!;
  const others = request.participants.filter((p) =>
    p.userId !== from.userId && p.userId !== to.userId
  );
  const already = participantOf(request, to.userId);
  return {
    ...request,
    outcomeOwnerId: to.userId,
    updatedAt: at,
    participants: [
      {
        userId: to.userId,
        name: already?.name ?? to.name,
        email: already?.email ?? to.email,
        role: "outcome_owner",
        invitedBy: already ? already.invitedBy : actor.userId,
        joinedAt: already?.joinedAt ?? at,
      },
      ...others,
      { ...from, role: "observer" },
    ],
    transitions: [...request.transitions, {
      from: request.status,
      to: request.status,
      action: "transferOwnership",
      by: actor.userId,
      at,
      note: `Outcome owner changed from ${from.name} to ${
        already?.name ?? to.name
      }.`,
    }],
  };
}
