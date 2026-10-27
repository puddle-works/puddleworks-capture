import { DomainError } from "./errors.ts";
import {
  type Action,
  ACTIONS,
  checkTransition,
  isClosed,
} from "./lifecycle.ts";
import type { Person, Request } from "./model.ts";
import { can, canRead, roleOf } from "./permissions.ts";

export type AllowedAction =
  | Action
  | "editDetails"
  | "editSpecification"
  | "message"
  | "invite"
  | "join";

/**
 * What this person may do to the request right now, so a client can show only
 * the buttons the API would accept. The API still checks every call.
 */
export function allowedActions(
  request: Request,
  person: Person,
): AllowedAction[] {
  if (!canRead(request, person)) return [];
  const open = request.status !== "draft" && !isClosed(request);
  const role = roleOf(request, person.userId);
  if (!role) return open && person.isBuilder ? ["join"] : [];

  const allowed: AllowedAction[] = ACTIONS.filter((action) => {
    try {
      checkTransition(request, person, action);
      return true;
    } catch (e) {
      if (e instanceof DomainError) return false;
      throw e;
    }
  });
  if (role === "outcome_owner" && request.status === "draft") {
    allowed.push("editDetails");
  }
  if (
    can(role, "editSpecification") &&
    (request.status === "draft" || request.status === "discussing")
  ) {
    allowed.push("editSpecification");
  }
  if (open && can(role, "message")) allowed.push("message");
  if (open && can(role, "invite")) allowed.push("invite");
  return allowed;
}
