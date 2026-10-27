/**
 * @puddleworks/capture/requests — Capture's requests, kept in swamp data
 *
 * Capture is where requests for small apps are raised, discussed and agreed.
 * Each method acts as one person in the people list, named by `as` (an
 * email) or the behavior's `defaultAs`, and Capture's rules decide what that
 * person may do: the outcome owner submits and agrees, builders join and
 * write the specification, observers read.
 *
 * Output:
 * - `request`: one request and everything on it (`request-<id>`), a new
 *   version for every change. Each has a number, #1 for the first, which
 *   methods take in place of its id.
 * - `person`: someone in the people list (`person-<userId>`).
 * - `view`: one request as the person asking sees it (`view-<id>`).
 * - `requestList`: the requests in one scope and status (`requests-<scope>-<status>`).
 * - `reviewPrompt`: what a reviewer of the frozen spec is asked (`review-prompt-<id>`).
 * - `outcomeSpec`: an exported outcome-spec/v1 document (`outcome-spec-<id>`).
 * - `outcomeSpecMarkdown`: the same, as Markdown (`outcome-spec-md-<id>`).
 * - `importResult`: what the last import brought in (`import-latest`).
 *
 * @module
 */
import { z } from "npm:zod@4.6.5";
import {
  DomainError,
  EXPORT_FORMATS,
  REQUEST_STATUSES,
  REVIEW_VERDICTS,
  ROLES,
  SpecificationContentSchema,
} from "./_lib/domain/index.ts";
import { createServices, type Services } from "./_lib/capture/services.ts";
import type { Snapshot } from "./_lib/capture/snapshot.ts";
import type { Stored } from "./_lib/capture/ports.ts";
import { type StoreContext, SwampStore } from "./_lib/capture/swamp_store.ts";
import { toRequestView, toSummary } from "./_lib/capture/views.ts";

/** The behavior's settings: where request pages are served, and who acts by default. */
export const GlobalArgsSchema = z.object({
  appUrl: z.url().default("http://127.0.0.1:3002").describe(
    "Where the request pages are served, with no trailing slash. Exported outcome specs link to <appUrl>/requests/<id>.",
  ),
  defaultAs: z.email().optional().describe(
    "Who acts when a method's `as` is left out, such as the account a workflow logs requests for.",
  ),
});
/** The settings, as the methods see them. */
export type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

/** true or false, also as the text the command line sends. */
const flag = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean(),
);

const as = z.email().optional().describe(
  "The email of the person acting; they must be in the people list. Defaults to the behavior's defaultAs.",
);
const id = z.string().min(1).max(100).describe(
  "The request's number, such as 12 or #12, or its id.",
);
const withId = z.object({ as, id });
const reason = (what: string) =>
  z.string().max(2_000).default("").describe(what);

const SummarySchema = z.object({
  id: z.string(),
  number: z.number().int().nullable(),
  title: z.string(),
  status: z.enum(REQUEST_STATUSES),
  outcomeOwner: z.object({ userId: z.string(), name: z.string() }),
  yourRole: z.enum(ROLES).nullable(),
  openQuestionCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const OutcomeSpecSchema = z.looseObject({
  format: z.literal("puddleworks.dev/outcome-spec/v1"),
  request: z.looseObject({
    id: z.string(),
    title: z.string(),
    url: z.string(),
  }),
  specification: z.looseObject({ version: z.number().int() }),
  agreement: z.looseObject({ agreedAt: z.string(), specHash: z.string() }),
  exportedAt: z.string(),
});

interface CaptureContext extends StoreContext {
  globalArgs: GlobalArgs;
  repoDir: string;
  logger: { info: (message: string, props?: Record<string, unknown>) => void };
}

type Output = Promise<{ dataHandles: { name: string }[] }>;

/** Runs one use case against swamp data and returns what it wrote. */
async function run(
  context: CaptureContext,
  use: (services: Services, store: SwampStore) => Promise<unknown>,
): Output {
  const store = new SwampStore(context);
  const services = createServices({
    store,
    clock: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    appUrl: context.globalArgs.appUrl.replace(/\/+$/, ""),
  });
  try {
    await use(services, store);
  } catch (e) {
    // Capture's own refusals are worded for people; show them as they are.
    if (e instanceof DomainError) throw new Error(`${e.message} (${e.code})`);
    throw e;
  }
  return { dataHandles: store.handles };
}

function actingAs(args: { as?: string }, context: CaptureContext): string {
  const who = args.as ?? context.globalArgs.defaultAs;
  if (!who) {
    throw new Error(
      "Say who is acting: pass as=<email>, or set defaultAs on this behavior.",
    );
  }
  return who;
}

/** A method that acts on one request and saves it, logged as `done`, such as "Submitted". */
function change<A extends { as?: string; id: string }>(
  description: string,
  done: string,
  argumentsSchema: z.ZodType<A>,
  use: (
    services: Services,
    as: string,
    args: A,
  ) => Promise<Stored | { stored: Stored }>,
) {
  return {
    description,
    arguments: argumentsSchema,
    execute: (args: A, context: CaptureContext): Output =>
      run(context, async (services) => {
        const out = await use(services, actingAs(args, context), args);
        const stored = "stored" in out ? out.stored : out;
        context.logger.info(
          "{done} request #{number} ({id}): now {status}, version {version}",
          {
            done,
            number: stored.number,
            id: stored.request.id,
            status: stored.request.status,
            version: stored.version,
          },
        );
      }),
  };
}

/** The behavior type: Capture's people and requests, and every use case on them. */
export const model = {
  type: "@puddleworks/capture/requests",
  version: "2026.10.27.6",
  globalArguments: GlobalArgsSchema,
  // Moves existing instances' typeVersion along; the settings are unchanged.
  upgrades: [
    {
      toVersion: "2026.10.27.2",
      description: "Request numbers; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.27.3",
      description: "Every change is logged; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.27.4",
      description:
        "appUrl defaults to the viewer's port 3002; set values are kept",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.27.5",
      description:
        "A reviewer role; agree waits for open questions; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.27.6",
      description: "Agent review of the frozen spec; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  resources: {
    request: {
      description:
        "One request and everything on it, with the version count and what was kept from before Capture.",
      schema: z.looseObject({
        id: z.string(),
        number: z.number().int().nullable(),
        title: z.string(),
        status: z.enum(REQUEST_STATUSES),
        outcomeOwnerId: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        version: z.number().int(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 50,
    },
    person: {
      description:
        "Someone in the people list: who they are and whether they build.",
      schema: z.object({
        userId: z.string(),
        name: z.string(),
        email: z.string(),
        isBuilder: z.boolean(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    view: {
      description:
        "One request as the person who asked sees it, with what they may do now.",
      schema: SummarySchema.extend({
        viewer: z.string(),
        initialDescription: z.string(),
        currentProcess: z.string(),
        closedReason: z.string().nullable(),
        participants: z.array(
          z.looseObject({
            userId: z.string(),
            email: z.string(),
            role: z.enum(ROLES),
          }),
        ),
        specification: z.looseObject({ version: z.number().int() }).nullable(),
        agreedVersion: z.number().int().nullable(),
        allowedActions: z.array(z.string()),
        specificationEtag: z.string(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    requestList: {
      description:
        "The requests in one scope and status, as the person who asked sees them.",
      schema: z.object({
        viewer: z.string(),
        scope: z.enum(["mine", "available"]),
        status: z.enum(REQUEST_STATUSES).nullable(),
        items: z.array(SummarySchema),
        truncated: z.boolean(),
        fetchedAt: z.string(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    reviewPrompt: {
      description:
        "What a reviewer is asked about the specification up for agreement, and which version it is.",
      schema: z.object({
        requestId: z.string(),
        number: z.number().int().nullable(),
        version: z.number().int(),
        prompt: z.string(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    outcomeSpec: {
      description: "An exported outcome-spec/v1 document.",
      schema: OutcomeSpecSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    outcomeSpecMarkdown: {
      description: "An exported outcome spec as Markdown.",
      schema: z.object({
        requestId: z.string(),
        format: z.literal("markdown"),
        markdown: z.string(),
        exportedAt: z.string(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    importResult: {
      description:
        "What the last import brought in and what it found already here.",
      schema: z.object({
        path: z.string(),
        snapshotExportedAt: z.string(),
        peopleAdded: z.number().int(),
        peopleSkipped: z.number().int(),
        requestsAdded: z.number().int(),
        requestsSkipped: z.number().int(),
        requestsNumbered: z.number().int(),
        importedAt: z.string(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
  },
  methods: {
    add_person: {
      description:
        "Add someone to the people list, so they can act and be invited.",
      arguments: z.object({
        email: z.email().describe(
          "Their email; it is who they are in Capture.",
        ),
        name: z.string().trim().min(1).max(200).describe(
          "Their name, as others will see it.",
        ),
        builder: flag.default(false).describe(
          "Whether they are one of the builders.",
        ),
      }),
      execute: (
        args: { email: string; name: string; builder: boolean },
        context: CaptureContext,
      ) =>
        run(context, async (services) => {
          const person = await services.addPerson(args);
          context.logger.info("Added {name} <{email}>", { ...person });
        }),
    },
    update_person: {
      description:
        "Change someone's name or whether they build. Requests keep the name they joined with.",
      arguments: z.object({
        email: z.email().describe("Their email."),
        name: z.string().trim().min(1).max(200).optional().describe(
          "Their new name.",
        ),
        builder: flag.optional().describe(
          "Whether they are one of the builders.",
        ),
      }),
      execute: (
        args: { email: string; name?: string; builder?: boolean },
        context: CaptureContext,
      ) =>
        run(context, async (services) => {
          const person = await services.updatePerson(args);
          context.logger.info(
            "Updated {name} <{email}>; builder: {isBuilder}",
            {
              ...person,
            },
          );
        }),
    },

    create_request: {
      description:
        "Log a request as a draft owned by the person acting. Pass idempotencyKey so a retry gives back the same request.",
      arguments: z.object({
        as,
        title: z.string().min(1).max(200).describe(
          "A short name for the request.",
        ),
        description: z.string().max(20_000).describe(
          "What is wanted, in the requester's words.",
        ),
        currentProcess: z.string().max(20_000).default("").describe(
          "How it is done today, if at all.",
        ),
        idempotencyKey: z.string().min(1).max(200).optional().describe(
          "The same key from the same person always gives the same request, so a retry never makes a second one.",
        ),
      }),
      execute: (
        args: {
          as?: string;
          title: string;
          description: string;
          currentProcess: string;
          idempotencyKey?: string;
        },
        context: CaptureContext,
      ) =>
        run(context, async (services, store) => {
          const { stored, created } = await services.create(
            actingAs(args, context),
            {
              title: args.title,
              initialDescription: args.description,
              currentProcess: args.currentProcess,
            },
            args.idempotencyKey,
          );
          // A retry changes nothing, but writes the request again so swamp
          // gets a real handle for it: a step reading the output sees the
          // request it made the first time. Numbering it may have written it
          // already, and then that write's handle is the one.
          if (!created && !store.wrote(stored.request.id)) {
            await store.saveRequest(stored);
          }
          context.logger.info(
            created
              ? "Logged request #{number} ({id}): {title}"
              : "Already logged as request #{number} ({id}): {title}",
            {
              number: stored.number,
              id: stored.request.id,
              title: stored.request.title,
            },
          );
        }),
    },
    get_request: {
      description: "Read one request as the person acting sees it.",
      arguments: withId,
      execute: (args: { as?: string; id: string }, context: CaptureContext) =>
        run(context, async (services, store) => {
          const who = actingAs(args, context);
          const person = await services.actor(who);
          const stored = await services.get(who, args.id);
          const { request } = stored;
          store.add(
            await context.writeResource("view", `view-${request.id}`, {
              viewer: person.email,
              ...toRequestView(stored, person),
            }),
          );
          context.logger.info("Read request #{number} ({id}): {status}", {
            number: stored.number,
            id: request.id,
            status: request.status,
          });
        }),
    },
    list_requests: {
      description:
        "List the requests the person acting is on, or, for a builder, the open ones they could join.",
      arguments: z.object({
        as,
        scope: z.enum(["mine", "available"]).default("mine").describe(
          "mine: requests the person is on. available: open requests a builder could join.",
        ),
        status: z.enum(REQUEST_STATUSES).optional().describe(
          "Only requests in this state.",
        ),
        max: z.coerce.number().int().min(1).max(1000).default(500).describe(
          "Stop after this many requests.",
        ),
      }),
      execute: (
        args: {
          as?: string;
          scope: "mine" | "available";
          status?: (typeof REQUEST_STATUSES)[number];
          max: number;
        },
        context: CaptureContext,
      ) =>
        run(context, async (services, store) => {
          const who = actingAs(args, context);
          const person = await services.actor(who);
          const { items, truncated } = await services.list(who, args);
          store.add(
            await context.writeResource(
              "requestList",
              `requests-${args.scope}-${args.status ?? "all"}`,
              {
                viewer: person.email,
                scope: args.scope,
                status: args.status ?? null,
                items: items.map((s) => toSummary(s, person)),
                truncated,
                fetchedAt: new Date().toISOString(),
              },
            ),
          );
          context.logger.info("Found {count} {scope} requests{more}", {
            count: items.length,
            scope: args.scope,
            more: truncated ? " (more were left out; raise max)" : "",
          });
        }),
    },
    join_request: change(
      "Join an open request as a builder. The person acting must be a builder.",
      "Joined",
      withId,
      (s, who, a) => s.join(who, a.id),
    ),

    edit_details: change(
      "Change a request's title, description or current process. Only its outcome owner can.",
      "Edited the details of",
      withId.extend({
        title: z.string().min(1).max(200).optional().describe("The new title."),
        description: z.string().max(20_000).optional().describe(
          "The new description.",
        ),
        currentProcess: z.string().max(20_000).optional().describe(
          "The new current process.",
        ),
      }),
      (s, who, a) =>
        s.editDetails(who, a.id, {
          ...(a.title !== undefined && { title: a.title }),
          ...(a.description !== undefined &&
            { initialDescription: a.description }),
          ...(a.currentProcess !== undefined &&
            { currentProcess: a.currentProcess }),
        }),
    ),
    submit: change(
      "Submit a draft, so builders can see it and discussion starts.",
      "Submitted",
      withId,
      (s, who, a) => s.submit(who, a.id),
    ),
    propose: change(
      "Propose the current specification for agreement. It must have no problems left.",
      "Proposed",
      withId,
      (s, who, a) => s.propose(who, a.id),
    ),
    request_changes: change(
      "Send a proposed specification back for changes. The outcome owner, a builder or a reviewer can.",
      "Asked for changes to",
      withId.extend({ note: reason("What should change.") }),
      (s, who, a) => s.requestChanges(who, a.id, a.note),
    ),
    agree: change(
      "Agree to the proposed specification version. Only the outcome owner can.",
      "Agreed to",
      withId.extend({
        version: z.coerce.number().int().min(1).describe(
          "The version being agreed to.",
        ),
      }),
      (s, who, a) => s.agree(who, a.id, a.version),
    ),
    revise: change(
      "Start a new specification version after agreement.",
      "Started a new version of",
      withId,
      (s, who, a) => s.revise(who, a.id),
    ),
    withdraw: change(
      "Withdraw a request. Only its outcome owner can.",
      "Withdrew",
      withId.extend({ reason: reason("Why it is withdrawn.") }),
      (s, who, a) => s.withdraw(who, a.id, a.reason),
    ),
    decline: change(
      "Decline a request as a builder.",
      "Declined",
      withId.extend({
        reason: z.string().trim().min(1).max(2_000).describe(
          "Why it is declined.",
        ),
      }),
      (s, who, a) => s.decline(who, a.id, a.reason),
    ),

    invite: change(
      "Invite someone in the people list onto a request, as a builder, an observer or a reviewer.",
      "Invited someone onto",
      withId.extend({
        email: z.email().describe("Who to invite."),
        role: z.enum(["builder", "observer", "reviewer"]).describe(
          "What they will be on the request.",
        ),
      }),
      (s, who, a) => s.invite(who, a.id, { email: a.email, role: a.role }),
    ),
    remove_participant: change(
      "Take someone off a request, by the email they joined with.",
      "Took someone off",
      withId.extend({ email: z.email().describe("Who to take off.") }),
      (s, who, a) => s.removeParticipant(who, a.id, a.email),
    ),

    post_message: change(
      "Post a comment, question or decision on a request.",
      "Posted a message on",
      withId.extend({
        kind: z.enum(["comment", "question", "decision"]).default("comment")
          .describe("What sort of message it is."),
        body: z.string().trim().min(1).max(20_000).describe("What it says."),
      }),
      (s, who, a) => s.postMessage(who, a.id, { kind: a.kind, body: a.body }),
    ),
    resolve_question: change(
      "Mark a question answered, optionally by the message that answered it.",
      "Resolved a question on",
      withId.extend({
        questionId: z.string().min(1).describe("The question's message id."),
        resolutionMessageId: z.string().min(1).optional().describe(
          "The message that answered it.",
        ),
      }),
      (s, who, a) =>
        s.resolveQuestion(
          who,
          a.id,
          a.questionId,
          a.resolutionMessageId ?? null,
        ),
    ),

    edit_specification: change(
      "Write the specification's current version. Builders can.",
      "Wrote the specification of",
      withId.extend({
        specification: z.preprocess(
          (v) => (typeof v === "string" ? JSON.parse(v) : v),
          SpecificationContentSchema,
        ).describe(
          "problemStatement, desiredOutcome, scope {in, out}, constraints, assumptions and acceptanceCriteria [{id, text}], as an object or JSON text.",
        ),
        basedOnMessageIds: z.array(z.string()).default([]).describe(
          "The messages it draws on.",
        ),
        ifMatch: z.string().optional().describe(
          "The specificationEtag from get_request. If the specification has changed since, the edit is refused.",
        ),
      }),
      (s, who, a) =>
        s.editSpecification(
          who,
          a.id,
          { content: a.specification, basedOnMessageIds: a.basedOnMessageIds },
          a.ifMatch ?? null,
        ),
    ),

    review_prompt: {
      description:
        "Write what a reviewer is asked about the specification up for agreement. Only a reviewer on the request can.",
      arguments: withId,
      execute: (args: { as?: string; id: string }, context: CaptureContext) =>
        run(context, async (services, store) => {
          const { stored, version, prompt } = await services.reviewPrompt(
            actingAs(args, context),
            args.id,
          );
          // Named by id, as args.id may be the request's number.
          const { id } = stored.request;
          store.add(
            await context.writeResource("reviewPrompt", `review-prompt-${id}`, {
              requestId: id,
              number: stored.number,
              version,
              prompt,
            }),
          );
          context.logger.info(
            "Wrote the review prompt for version {version} of request #{number} ({id})",
            { version, number: stored.number, id },
          );
        }),
    },
    record_review: change(
      "Record a review of the specification up for agreement: each finding becomes a question, the verdict a decision, and a major revision or not_safe asks for changes. Only a reviewer on the request can.",
      "Recorded a review of",
      withId.extend({
        review: z.preprocess(
          (v) => (typeof v === "string" ? JSON.parse(v) : v),
          z.object({
            verdict: z.enum(REVIEW_VERDICTS),
            summary: z.string().max(2_000).optional(),
            findings: z.array(
              z.object({ id: z.string(), text: z.string() }),
            ),
          }),
        ).describe(
          "{ verdict: ready | minor_revision | major_revision | not_safe, summary?, findings: [{ id, text }] }, as an object or JSON text.",
        ),
        version: z.coerce.number().int().min(1).optional().describe(
          "The version reviewed. If another version is up for agreement now, the review is refused.",
        ),
      }),
      (s, who, a) => s.recordReview(who, a.id, a.review, a.version),
    ),

    export_outcome_spec: {
      description:
        "Export an agreed request as outcome-spec/v1 (or Markdown). The request moves to Exported.",
      arguments: withId.extend({
        format: z.enum(EXPORT_FORMATS).default("outcome-spec/v1+json").describe(
          "The document's format.",
        ),
      }),
      execute: (
        args: {
          as?: string;
          id: string;
          format: (typeof EXPORT_FORMATS)[number];
        },
        context: CaptureContext,
      ) =>
        run(context, async (services, store) => {
          const { stored, document } = await services.export(
            actingAs(args, context),
            args.id,
            args.format,
          );
          // Named by id, as args.id may be the request's number.
          const { id, updatedAt: exportedAt } = stored.request;
          store.add(
            typeof document === "string"
              ? await context.writeResource(
                "outcomeSpecMarkdown",
                `outcome-spec-md-${id}`,
                {
                  requestId: id,
                  format: "markdown",
                  markdown: document,
                  exportedAt,
                },
              )
              : await context.writeResource(
                "outcomeSpec",
                `outcome-spec-${id}`,
                { ...document },
              ),
          );
          context.logger.info("Exported request #{number} ({id}) as {format}", {
            number: stored.number,
            id,
            format: args.format,
          });
        }),
    },

    import: {
      description:
        "Bring in a capture-snapshot/v1 file, as Capture's old Node app exported. Adds only what isn't here yet, so it is safe to run again.",
      arguments: z.object({
        path: z.string().min(1).describe(
          "The snapshot file, relative to the repository.",
        ),
      }),
      execute: (args: { path: string }, context: CaptureContext) =>
        run(context, async (services, store) => {
          const file = args.path.startsWith("/")
            ? args.path
            : `${context.repoDir}/${args.path}`;
          const snapshot = JSON.parse(
            await Deno.readTextFile(file),
          ) as Snapshot;
          const counts = await services.importSnapshot(snapshot);
          store.add(
            await context.writeResource("importResult", "import-latest", {
              path: args.path,
              snapshotExportedAt: snapshot.exportedAt,
              ...counts,
              importedAt: new Date().toISOString(),
            }),
          );
          context.logger.info(
            "Imported {peopleAdded} people and {requestsAdded} requests ({peopleSkipped} and {requestsSkipped} already here); numbered {requestsNumbered} requests",
            { ...counts },
          );
        }),
    },
  },
};
