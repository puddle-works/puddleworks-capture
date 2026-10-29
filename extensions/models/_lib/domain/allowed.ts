import { openQuestions } from "./discussion.ts";
import { DomainError } from "./errors.ts";
import {
  type Action,
  ACTIONS,
  checkTransition,
  isClosed,
} from "./lifecycle.ts";
import type { Person, Request } from "./model.ts";
import { can, canRead, roleOf } from "./permissions.ts";
import { BUILT_FROM_AGREED } from "./specification.ts";

export type AllowedAction =
  | Action
  | "editDetails"
  | "editSpecification"
  | "recordBuildResult"
  | "export"
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
    // Recording a build result takes these, so they aren't offered alone.
    if (action === "build" || action === "release") return false;
    if (action === "agree" && openQuestions(request).length > 0) return false;
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
  const built = BUILT_FROM_AGREED.includes(request.status);
  if (can(role, "recordBuildResult") && built) {
    allowed.push("recordBuildResult");
  }
  // Exporting leaves the status as it is, so it isn't a transition.
  if (can(role, "export") && built) allowed.push("export");
  if (open && can(role, "message")) allowed.push("message");
  if (open && can(role, "invite")) allowed.push("invite");
  return allowed;
}
