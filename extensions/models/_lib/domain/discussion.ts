import { z } from "npm:zod@4.6.5";
import { DomainError } from "./errors.ts";
import {
  type Message,
  MESSAGE_KINDS,
  type Person,
  type Request,
} from "./model.ts";
import { requirePermission } from "./permissions.ts";
import { requireOpen } from "./request.ts";

export const NewMessageSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(MESSAGE_KINDS),
  body: z.string().trim().min(1, "Write something first.").max(20_000),
});
export type NewMessage = z.input<typeof NewMessageSchema>;

export function postMessage(
  request: Request,
  actor: Person,
  input: NewMessage,
  at: string,
): Request {
  requirePermission(request, actor, "message");
  requireOpen(request, "posting");
  const parsed = NewMessageSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError(
      "invalid_input",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  if (request.messages.some((m) => m.id === parsed.data.id)) {
    throw new DomainError("invalid_input", "That message id is already used.");
  }
  const message: Message = {
    ...parsed.data,
    authorId: actor.userId,
    authorName: actor.name,
    createdAt: at,
    resolvedAt: null,
    resolvedBy: null,
    resolutionMessageId: null,
  };
  return {
    ...request,
    updatedAt: at,
    messages: [...request.messages, message],
  };
}

export function openQuestions(request: Request): Message[] {
  return request.messages.filter((m) =>
    m.kind === "question" && m.resolvedAt === null
  );
}

export function resolveQuestion(
  request: Request,
  actor: Person,
  questionId: string,
  resolutionMessageId: string | null,
  at: string,
): Request {
  requirePermission(request, actor, "resolveQuestion");
  requireOpen(request, "resolving questions");
  const question = request.messages.find((m) => m.id === questionId);
  if (!question) {
    throw new DomainError(
      "not_found",
      "There is no such message on this request.",
    );
  }
  if (question.kind !== "question" || question.resolvedAt !== null) {
    throw new DomainError(
      "invalid_input",
      "That message isn't an open question.",
    );
  }
  if (
    resolutionMessageId !== null &&
    !request.messages.some((m) => m.id === resolutionMessageId)
  ) {
    throw new DomainError(
      "not_found",
      "The answering message isn't on this request.",
    );
  }
  return {
    ...request,
    updatedAt: at,
    messages: request.messages.map((m) =>
      m.id === questionId
        ? {
          ...m,
          resolvedAt: at,
          resolvedBy: actor.userId,
          resolutionMessageId,
        }
        : m
    ),
  };
}
