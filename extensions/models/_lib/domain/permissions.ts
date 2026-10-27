import { DomainError } from "./errors.ts";
import type { Participant, Person, Request, Role } from "./model.ts";

export type Permission =
  | "message"
  | "resolveQuestion"
  | "editSpecification"
  | "propose"
  | "requestChanges"
  | "agree"
  | "invite"
  | "removeParticipant"
  | "withdraw"
  | "decline"
  | "export"
  | "revise";

const GRANTS: Record<Role, readonly Permission[]> = {
  outcome_owner: [
    "message",
    "resolveQuestion",
    "editSpecification",
    "propose",
    "requestChanges",
    "agree",
    "invite",
    "removeParticipant",
    "withdraw",
    "export",
    "revise",
  ],
  // A builder may invite other builders only; inviteParticipant checks that.
  builder: [
    "message",
    "resolveQuestion",
    "editSpecification",
    "propose",
    "requestChanges",
    "invite",
    "decline",
    "export",
    "revise",
  ],
  observer: [],
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

export function participantOf(
  request: Request,
  userId: string,
): Participant | undefined {
  return request.participants.find((p) => p.userId === userId);
}

export function roleOf(request: Request, userId: string): Role | undefined {
  return participantOf(request, userId)?.role;
}

/** A draft is the outcome owner's alone; after that any builder may look before joining. */
export function canRead(request: Request, person: Person): boolean {
  if (participantOf(request, person.userId)) return true;
  return request.status !== "draft" && person.isBuilder;
}

const PERMISSION_WORDS: Record<Permission, string> = {
  message: "post messages",
  resolveQuestion: "resolve questions",
  editSpecification: "edit the specification",
  propose: "propose the specification for agreement",
  requestChanges: "ask for changes",
  agree: "agree to the specification",
  invite: "invite people",
  removeParticipant: "remove people",
  withdraw: "withdraw the request",
  decline: "decline the request",
  export: "export the specification",
  revise: "revise the specification",
};

const ROLE_WORDS: Record<Role, string> = {
  outcome_owner: "the outcome owner",
  builder: "a builder",
  observer: "an observer",
};

export function roleWords(role: Role): string {
  return ROLE_WORDS[role];
}

/** The acting person's role, or a not_allowed error saying why not. */
export function requirePermission(
  request: Request,
  actor: Person,
  permission: Permission,
): Role {
  const role = roleOf(request, actor.userId);
  if (!role) {
    throw new DomainError("not_allowed", "You aren't part of this request.");
  }
  if (!can(role, permission)) {
    throw new DomainError(
      "not_allowed",
      `As ${ROLE_WORDS[role]} you can't ${PERMISSION_WORDS[permission]}.`,
    );
  }
  return role;
}
