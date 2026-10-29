// The shapes the methods write and the viewer is sent, built from the
// domain's data. The method views match what the Capture API returned, so
// workflows that read them see the same fields.
import {
  allowedActions,
  type BuildResultRecord,
  currentBuild,
  exampleChecks,
  latestAgreed,
  latestSpecification,
  openQuestions,
  type Person,
  registryUrl,
  releaseProblems,
  type Request,
  roleOf,
  specificationProblems,
} from "../domain/index.ts";
import type { Stored } from "./ports.ts";
import { specificationEtag } from "./services.ts";
import type {
  PersonRef,
  WebBuildResult,
  WebRequest,
  WebSummary,
} from "./view_types.ts";

function nameOf(request: Request, userId: string): string {
  // Someone who has left keeps their id on the record; their name went with them.
  return request.participants.find((p) => p.userId === userId)?.name ??
    "Former participant";
}

function personRef(request: Request, userId: string): PersonRef {
  return { userId, name: nameOf(request, userId) };
}

export function toSummary({ request, number }: Stored, viewer: Person) {
  return {
    id: request.id,
    number,
    title: request.title,
    status: request.status,
    outcomeOwner: personRef(request, request.outcomeOwnerId),
    yourRole: roleOf(request, viewer.userId) ?? null,
    openQuestionCount: openQuestions(request).length,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
export type RequestSummary = ReturnType<typeof toSummary>;

export function toRequestView(stored: Stored, viewer: Person) {
  const { request } = stored;
  const spec = latestSpecification(request);
  return {
    ...toSummary(stored, viewer),
    initialDescription: request.initialDescription,
    currentProcess: request.currentProcess,
    requestedPhrase: request.requestedPhrase ?? null,
    closedReason: request.closedReason,
    participants: request.participants.map((p) => ({ ...p })),
    specification: spec
      ? {
        version: spec.version,
        status: spec.status,
        updatedAt: spec.updatedAt,
      }
      : null,
    agreedVersion: latestAgreed(request)?.version ?? null,
    allowedActions: allowedActions(request, viewer),
    /** Pass as ifMatch to edit_specification, so an edit made against an older version is refused. */
    specificationEtag: specificationEtag(request),
  };
}
export type RequestView = ReturnType<typeof toRequestView>;

export function toWebSummary({ request, before, number }: Stored): WebSummary {
  return {
    id: request.id,
    number,
    title: request.title,
    status: request.status,
    outcomeOwner: personRef(request, request.outcomeOwnerId),
    participantCount: request.participants.length,
    openQuestionCount: openQuestions(request).length,
    specificationVersion: latestSpecification(request)?.version ?? null,
    imported: before !== null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function webBuildResult(
  request: Request,
  record: BuildResultRecord,
): WebBuildResult {
  return {
    ...record,
    recordedByName: nameOf(request, record.recordedBy),
    registryUrl: record.result.published
      ? registryUrl(record.result.extension)
      : null,
    examples: exampleChecks(request, record.result),
    releaseProblems: releaseProblems(request, record),
  };
}

/** Everything on the request except what the viewer has no use for: idempotency keys and the legacy record. */
export function toWebRequest(stored: Stored): WebRequest {
  const { request } = stored;
  const current = currentBuild(request);
  return {
    ...toWebSummary(stored),
    initialDescription: request.initialDescription,
    currentProcess: request.currentProcess,
    requestedPhrase: request.requestedPhrase ?? null,
    closedReason: request.closedReason,
    participants: request.participants,
    messages: request.messages,
    specifications: request.specifications.map((s) => ({
      ...s,
      createdByName: nameOf(request, s.createdBy),
      problems: specificationProblems(s.content, request.requestedPhrase),
    })),
    agreements: request.agreements.map((a) => ({
      specVersion: a.specVersion,
      agreedBy: personRef(request, a.agreedBy),
      agreedAt: a.agreedAt,
      specHash: a.specHash,
    })),
    exports: request.exports.map((e) => ({
      ...e,
      exportedByName: nameOf(request, e.exportedBy),
    })),
    build: current ? webBuildResult(request, current) : null,
    buildResults: request.buildResults.map((b) => webBuildResult(request, b)),
    transitions: request.transitions.map((t) => ({
      ...t,
      byName: nameOf(request, t.by),
    })),
    before: stored.before,
  };
}
