/**
 * @puddleworks/capture/requests — Capture's requests, kept in swamp data
 *
 * Capture is where requests for small apps are raised, discussed and agreed.
 * Each method acts as one person in the people list, named by `as` (an
 * email) or the behavior's `defaultAs`, and Capture's rules decide what that
 * person may do: the outcome owner submits and agrees, builders join and
 * write the specification, observers read. Once it is agreed,
 * start_building marks it Building when work starts, and record_build_result
 * records what a build of it produced. It is Released once the published
 * recipe matches the agreed one and its outcome owner has sent every example
 * through puddlerouter with record_router_test.
 *
 * Output:
 * - `request`: one request and everything on it (`request-<id>`), a new
 *   version for every change. Each has a number, #1 for the first, which
 *   methods take in place of its id.
 * - `person`: someone in the people list (`person-<userId>`).
 * - `signedIn`: who a swamp serve login is, for the Capture app
 *   (`signed-in-<nonce>`), kept a day.
 * - `standInNext`: whether a stand-in's turn follows a step taken in the
 *   Capture app (`stand-in-next-<id>`), kept a day.
 * - `view`: one request as the person asking sees it (`view-<id>`).
 * - `requestList`: the requests in one scope and status (`requests-<scope>-<status>`).
 * - `reviewPrompt`: what a reviewer of the frozen spec is asked (`review-prompt-<id>`).
 * - `standInPrompt`: what a stand-in agent is asked on its turn (`stand-in-prompt-<id>`).
 * - `outcomeSpec`: the outcome-spec/v1 document, written on agreeing and on
 *   each export (`outcome-spec-<id>`).
 * - `outcomeSpecMarkdown`: the same, as Markdown (`outcome-spec-md-<id>`).
 * - `exportResult`: what the last snapshot export wrote (`export-latest`).
 * - `importResult`: what the last import brought in (`import-latest`).
 *
 * @module
 */
import { z } from "npm:zod@4.6.7";
import {
  currentBuild,
  DISCUSSION_POINTS,
  DomainError,
  EXPORT_FORMATS,
  possibleDuplicates,
  PRINCIPAL_PATTERN,
  releaseProblems,
  REQUEST_STATUSES,
  REVIEW_VERDICTS,
  ROLES,
  ROUTER_TEST_OUTCOMES,
  SpecificationContentSchema,
  STAND_IN_ROLES,
  StandInTurnSchema,
} from "./_lib/domain/index.ts";
import { createServices, type Services } from "./_lib/capture/services.ts";
import type { Snapshot } from "./_lib/capture/snapshot.ts";
import {
  APP_STEPS,
  appStepCall,
  type AppStepInput,
  STAND_IN_AFTER,
} from "./_lib/capture/app_steps.ts";
import { readJsonInput } from "./_lib/capture/build_result_input.ts";
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
  standInAgent: z.string().trim().max(200).default("").describe(
    "The agent behavior stand-ins answer with after a step taken in the Capture app, such as a @mgreten/cli-agent behavior. Blank: the app brings in no stand-in.",
  ),
});
/** The settings, as the methods see them. */
export type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

/**
 * A value given as itself or as JSON text, as the command line sends it.
 * Text that isn't JSON fails validation, saying so without repeating any of
 * it, instead of throwing.
 */
function jsonOr<T extends z.ZodType>(schema: T) {
  return z.preprocess((v, ctx) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      // The parser's own message can quote the text, so it isn't passed on.
      ctx.addIssue({ code: "custom", message: "isn't valid JSON." });
      return z.NEVER;
    }
  }, schema);
}

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
/** A swamp serve login, as serve names a signed-in user. */
const principal = z.string().trim().regex(PRINCIPAL_PATTERN, {
  message: "is a swamp login such as user:alice.",
});
/** A discussion point; blank, as a workflow passes it, means none. */
const point = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.enum(DISCUSSION_POINTS).optional(),
);
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

/**
 * Runs another of this behavior's methods, as swamp would: its arguments
 * checked by its schema, then its execute.
 */
function runMethod(
  name: string,
  input: Record<string, unknown>,
  context: CaptureContext,
): Output {
  const method = (model.methods as unknown as Record<string, {
    arguments: z.ZodType;
    execute: (args: unknown, context: CaptureContext) => Output;
  }>)[name];
  const parsed = method.arguments.safeParse(input);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return method.execute(parsed.data, context);
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

/**
 * A method that acts on one request and saves it, logged as `done`, such as
 * "Submitted". `use` may write more data through `context`, adding it to `store`.
 */
function change<A extends { as?: string; id: string }>(
  description: string,
  done: string,
  argumentsSchema: z.ZodType<A>,
  use: (
    services: Services,
    as: string,
    args: A,
    context: CaptureContext,
    store: SwampStore,
  ) => Promise<Stored | { stored: Stored }>,
) {
  return {
    description,
    arguments: argumentsSchema,
    execute: (args: A, context: CaptureContext): Output =>
      run(context, async (services, store) => {
        const out = await use(
          services,
          actingAs(args, context),
          args,
          context,
          store,
        );
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
  version: "2026.11.27.2",
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
    {
      toVersion: "2026.10.28.1",
      description: "No settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.28.2",
      description: "Snapshot export; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.28.3",
      description: "Every spec has a recipe; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.28.4",
      description:
        "Agreeing writes the outcome spec; no Exported status; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.29.1",
      description:
        "record_build_result; Building and Released statuses; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.04.1",
      description:
        "edit_details works while discussing and is recorded in the history; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.08.1",
      description:
        "start_building marks an agreed request as Building before any build result; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.09.1",
      description:
        "Released with the page's Building text; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.09.2",
      description:
        "revise_specification, transfer_ownership, effects on the spec, a requester on logged requests, and Released needs puddlerouter evidence; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.10.1",
      description:
        "build-result/v2 with the published recipe, record_router_test for the outcome owner, and Released needs both; an outcome owner who is a builder can start building; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.16.1",
      description:
        "Text arguments that aren't JSON, and an import file that isn't JSON, are refused without quoting them; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.24.1",
      description:
        "Stand-in agents: add_person standIn, stand_in_prompt and record_stand_in_turn, and every deciding step refused from a stand-in; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.24.2",
      description:
        "zod 4.6.7, past advisory GHSA-mrhx-c7xc-m3w5; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.25.1",
      description:
        "Released with the app's steps and recent changes; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.27.1",
      description:
        "Swamp serve logins on the people list (principal), carried by snapshots, and app_step, which the Capture app runs as the signed-in person; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.27.2",
      description:
        "standInAgent, so a stand-in agent takes its turn after a step taken in the Capture app; set values are kept and it defaults to blank",
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
        standIn: z.enum(STAND_IN_ROLES).optional(),
        principal: z.string().optional(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    signedIn: {
      description:
        "Who in the people list a swamp serve login is, as app_step's whoami found it, so the Capture app can show that person's steps.",
      schema: z.object({
        principal: z.string(),
        userId: z.string(),
        name: z.string(),
        email: z.string(),
        isBuilder: z.boolean(),
      }),
      lifetime: "1d",
      garbageCollection: 1,
    },
    standInNext: {
      description:
        "Whether a stand-in agent takes its turn after a step taken in the Capture app, and who and on what, as app_stand_in found it (stand-in-next-<id>).",
      schema: z.object({
        due: z.boolean(),
        id: z.string(),
        agent: z.string(),
        standInAs: z.string(),
        point: z.string(),
      }),
      lifetime: "1d",
      garbageCollection: 5,
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
    standInPrompt: {
      description:
        "What a stand-in agent is asked on its turn, and about which discussion point.",
      schema: z.object({
        requestId: z.string(),
        number: z.number().int().nullable(),
        standIn: z.enum(STAND_IN_ROLES),
        point: z.enum(DISCUSSION_POINTS),
        prompt: z.string(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    outcomeSpec: {
      description:
        "The outcome-spec/v1 document, written on agreeing and on each export.",
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
    exportResult: {
      description: "Where the last snapshot export wrote, and how much.",
      schema: z.object({
        path: z.string(),
        people: z.number().int(),
        requests: z.number().int(),
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
        loginsCarried: z.number().int(),
        loginsDropped: z.number().int(),
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
        standIn: z.enum(STAND_IN_ROLES).optional().describe(
          "Marks a stand-in agent, not a person: requester or builder. It takes that role when one person holds both, and may only talk, draft and propose.",
        ),
        principal: principal.optional().describe(
          "Their swamp serve login, such as user:alice, so the Capture app acts as them when they sign in. One person each; never a stand-in.",
        ),
      }),
      execute: (
        args: {
          email: string;
          name: string;
          builder: boolean;
          standIn?: (typeof STAND_IN_ROLES)[number];
          principal?: string;
        },
        context: CaptureContext,
      ) =>
        run(context, async (services) => {
          const person = await services.addPerson(args);
          context.logger.info(
            person.principal
              ? "Added {name} <{email}>; swamp login: {principal}"
              : "Added {name} <{email}>",
            { ...person },
          );
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
        principal: principal.or(z.literal("")).optional().describe(
          "Their swamp serve login, such as user:alice, so the Capture app acts as them when they sign in. Blank takes it away.",
        ),
      }),
      execute: (
        args: {
          email: string;
          name?: string;
          builder?: boolean;
          principal?: string;
        },
        context: CaptureContext,
      ) =>
        run(context, async (services) => {
          const person = await services.updatePerson(args);
          context.logger.info(
            args.principal === undefined
              ? "Updated {name} <{email}>; builder: {isBuilder}"
              : "Updated {name} <{email}>; builder: {isBuilder}; swamp login: {login}",
            { ...person, login: person.principal ?? "none" },
          );
        }),
    },

    create_request: {
      description:
        "Log a request as a draft owned by the person acting, or by requester when a program logs it for the person who asked. Pass idempotencyKey so a retry gives back the same request.",
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
        phrase: z.string().max(500).default("").describe(
          "The turn a router couldn't answer. It becomes the requested phrase: the first example of the draft spec's recipe, which must stay as asked. Blank for none.",
        ),
        candidateExtensions: jsonOr(
          z.array(z.string().min(1).max(200)).max(50),
        ).default([]).describe(
          "Extensions a router's search found that may do most of the work, as a list or JSON text. They start the draft spec's recipe.",
        ),
        idempotencyKey: z.string().min(1).max(200).optional().describe(
          "The same key from the same person always gives the same request, so a retry never makes a second one.",
        ),
        requester: z.union([z.literal(""), z.email()]).default("").describe(
          "The email of the person who asked, who must be in the people list. They own the request, and it records that the person acting logged it for them. Blank: the person acting owns it.",
        ),
      }),
      execute: (
        args: {
          as?: string;
          title: string;
          description: string;
          currentProcess: string;
          phrase: string;
          candidateExtensions: string[];
          idempotencyKey?: string;
          requester: string;
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
              phrase: args.phrase,
              candidateExtensions: args.candidateExtensions,
            },
            args.idempotencyKey,
            args.requester || undefined,
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
      "Change a request's title, description or current process while it is a draft or being discussed. Only its outcome owner can; once submitted, each change shows in its history.",
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
      "Agree to the proposed specification version. Only the outcome owner can. Agreeing is the hand-off: it writes the outcome-spec/v1 document for the builder (outcome-spec-<id>).",
      "Agreed to",
      withId.extend({
        version: z.coerce.number().int().min(1).describe(
          "The version being agreed to.",
        ),
      }),
      async (s, who, a, context, store) => {
        const { stored, document } = await s.agree(who, a.id, a.version);
        store.add(
          await context.writeResource(
            "outcomeSpec",
            `outcome-spec-${stored.request.id}`,
            { ...document },
          ),
        );
        return stored;
      },
    ),
    transfer_ownership: change(
      "Hand a request to someone else in the people list as its outcome owner, such as the person who asked for a request a bot logged. Only the outcome owner can, while the request is open or a draft. The old owner stays on as an observer, and the change shows in the history.",
      "Handed over",
      withId.extend({
        to: z.email().describe("Who becomes the outcome owner."),
      }),
      (s, who, a) => s.transferOwnership(who, a.id, a.to),
    ),
    revise: change(
      "Start a new specification version after agreement.",
      "Started a new version of",
      withId,
      (s, who, a) => s.revise(who, a.id),
    ),
    start_building: change(
      "Mark an agreed request as Building, when work on it starts and before any build result. Only a builder can: one on the request, or its outcome owner when the people list marks them a builder. Build results recorded after that keep it Building until one is released.",
      "Started building",
      withId,
      (s, who, a) => s.startBuilding(who, a.id),
    ),
    record_router_test: change(
      "Record sending the agreed example phrases through puddlerouter on your own desk, with the current build's published version installed. Only the outcome owner can. Each test replaces your last one for that version; the request is released once every phrase was answered and nothing else stops it.",
      "Recorded a puddlerouter test of",
      withId.extend({
        version: z.string().trim().min(1).max(100).describe(
          "The extension version installed when the phrases went through.",
        ),
        results: z.preprocess(
          // Text that isn't JSON is left as text, so it fails as not a list.
          (v) => {
            if (typeof v !== "string") return v;
            try {
              return JSON.parse(v);
            } catch {
              return v;
            }
          },
          z.array(z.object({
            phrase: z.string().trim().min(1).max(500).describe(
              "An agreed example phrase, as written.",
            ),
            outcome: z.enum(ROUTER_TEST_OUTCOMES).describe(
              "answered; answered-after-yes for a write recipe that asked for a yes, then ran; or not-answered when it went to Claude or no recipe answered.",
            ),
            note: z.string().max(2_000).optional().describe(
              "What happened, such as what came back instead.",
            ),
          })).min(1).max(50),
        ).describe("One entry per phrase sent, as an array or JSON text."),
      }),
      async (s, who, a, context, store) => {
        const stored = await s.recordRouterTest(who, a.id, {
          version: a.version,
          results: a.results,
        });
        // The same test again saves nothing; write it so a step reading the
        // output still gets the request, as record_build_result does.
        if (!store.wrote(stored.request.id)) await store.saveRequest(stored);
        const current = currentBuild(stored.request);
        if (stored.request.status !== "released" && current) {
          context.logger.info("Not released yet: {problems}", {
            problems: releaseProblems(stored.request, current).join(" "),
          });
        }
        return stored;
      },
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
    close_as_duplicate: change(
      "Close a request that repeats another, such as a need a tool logged again. Its outcome owner or a builder can, while it is a draft or still open. The other request must not be closed, and counts it as asked again.",
      "Closed as a duplicate",
      withId.extend({
        of: z.string().trim().min(1).describe(
          "The request this one repeats: its number (12 or #12) or its id.",
        ),
      }),
      (s, who, a) => s.closeAsDuplicate(who, a.id, a.of),
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
        specification: jsonOr(
          SpecificationContentSchema,
        ).describe(
          "problemStatement, desiredOutcome, scope {in, out}, constraints, assumptions, acceptanceCriteria [{id, text}] and recipe {examples [{phrase, answer}], pieces [{name, shape: int, repo or word}], whenEmpty, candidateExtensions} and effects {kind: read or write, changes: what it changes, needed for write}, as an object or JSON text. Leave recipe or effects out to keep the one there; a spec with no effects counts as write. A requested phrase must stay the recipe's first example.",
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

    revise_specification: change(
      "Upload a revised specification, with why it changed, and propose it for the outcome owner to agree, in one step. The outcome owner or a builder can. An agreed, building or released request is revised first. Give the spec as specification, or as an edited outcome-spec/v1 file for this request (outcomeSpec), of which only the specification is used. If the spec isn't ready or questions are open, nothing changes.",
      "Proposed a revised specification for",
      withId.extend({
        reason: z.string().trim().min(1).max(2_000).describe(
          "Why the specification changed. It is kept on the new version and shown next to the agreement.",
        ),
        specification: jsonOr(
          SpecificationContentSchema,
        ).optional().describe(
          "The revised specification, as edit_specification takes it: an object or JSON text.",
        ),
        outcomeSpec: z.union([
          z.string().min(1),
          z.record(z.string(), z.unknown()),
        ]).optional().describe(
          "The revised spec as an edited outcome-spec/v1 document for this request: a file path relative to the repository, an https URL, JSON text, or an object.",
        ),
        basedOnVersion: z.coerce.number().int().min(1).optional().describe(
          "The version the change starts from; refused if a newer one exists. Defaults to outcomeSpec's specification.version.",
        ),
      }),
      async (s, who, a, context) =>
        s.reviseSpecification(who, a.id, {
          reason: a.reason,
          ...(a.specification !== undefined && { content: a.specification }),
          ...(a.outcomeSpec !== undefined && {
            outcomeSpec: await readJsonInput(a.outcomeSpec, {
              repoDir: context.repoDir,
              fetch: (url) => globalThis.fetch(url),
            }, "outcome spec"),
          }),
          ...(a.basedOnVersion !== undefined &&
            { basedOnVersion: a.basedOnVersion }),
        }),
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
    stand_in_prompt: {
      description:
        "Write what a stand-in agent is asked on its turn (stand-in-prompt-<id>). Refused unless one person holds both roles on the request and, for its status, the rule gives this stand-in's role the turn: the builder agent until the spec is agreed, the requester agent from Agreed on.",
      arguments: withId.extend({
        point: point.describe(
          "The discussion point: clarify, recipe, effects, open_questions, proposal, revision, router_test or duplicates. Left out or blank, it is taken from where the discussion is.",
        ),
      }),
      execute: (
        args: {
          as?: string;
          id: string;
          point?: (typeof DISCUSSION_POINTS)[number];
        },
        context: CaptureContext,
      ) =>
        run(context, async (services, store) => {
          const who = actingAs(args, context);
          const { stored, standIn, point, prompt } = await services
            .standInPrompt(who, args.id, args.point);
          const { id } = stored.request;
          store.add(
            await context.writeResource(
              "standInPrompt",
              `stand-in-prompt-${id}`,
              { requestId: id, number: stored.number, standIn, point, prompt },
            ),
          );
          context.logger.info(
            "Wrote the {standIn} agent's prompt on {point} for request #{number} ({id})",
            { standIn, point, number: stored.number, id },
          );
        }),
    },
    record_stand_in_turn: change(
      "Record a stand-in agent's turn: its comments and questions, and the builder agent's draft, proposal or revision. It joins the request first if it isn't on it. Refused unless the rule gives it the turn, as for stand_in_prompt. It can never agree, ask for changes, resolve questions, record builds or router tests, withdraw, or close a duplicate.",
      "Recorded a stand-in turn on",
      withId.extend({
        point: point.describe(
          "The discussion point the turn was asked about, as stand_in_prompt took it.",
        ),
        turn: jsonOr(StandInTurnSchema).describe(
          "{ messages: [{ kind: comment | question, body }], specification?, propose?, revisionReason? }, as an object or JSON text.",
        ),
      }),
      (s, who, a) => s.recordStandInTurn(who, a.id, a.turn, a.point),
    ),
    record_review: change(
      "Record a review of the specification up for agreement: each finding becomes a question, the verdict a decision, and a major revision or not_safe asks for changes. Only a reviewer on the request can.",
      "Recorded a review of",
      withId.extend({
        review: jsonOr(
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
        "Export an agreed request again as outcome-spec/v1 (or Markdown). Agreeing already wrote the outcome spec; this records another export and leaves the request agreed.",
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

    record_build_result: {
      description:
        "Record a build-result/v1 or /v2 against the request its source.url names. The first moves an agreed request to building, unless start_building already did. It is released once the latest build is a published v2 whose recipe has every agreed phrase as written and the agreed answer when there is nothing to show, every example passed, and the outcome owner has sent each phrase through puddlerouter with the published version (record_router_test). The same result twice changes nothing.",
      arguments: z.object({
        as,
        result: z.union([
          z.string().min(1),
          z.record(z.string(), z.unknown()),
        ]).describe(
          "The build result: a file path relative to the repository, an https URL, JSON text, or an object.",
        ),
      }),
      execute: (
        args: { as?: string; result: string | Record<string, unknown> },
        context: CaptureContext,
      ) =>
        run(context, async (services, store) => {
          const raw = await readJsonInput(args.result, {
            repoDir: context.repoDir,
            fetch: (url) => globalThis.fetch(url),
          });
          const stored = await services.recordBuildResult(
            actingAs(args, context),
            raw,
          );
          // The same result again saves nothing; write it so a step reading
          // the output still gets the request, as create_request does.
          if (!store.wrote(stored.request.id)) await store.saveRequest(stored);
          const { request } = stored;
          context.logger.info(
            "Recorded a build result for request #{number} ({id}): now {status}, version {version}",
            {
              number: stored.number,
              id: request.id,
              status: request.status,
              version: stored.version,
            },
          );
          const current = currentBuild(request);
          if (request.status !== "released" && current?.result.published) {
            context.logger.info("Not released yet: {problems}", {
              problems: releaseProblems(request, current).join(" "),
            });
          }
        }),
    },

    app_step: {
      description:
        "Take one of the Capture app's steps as the person whose swamp serve login is principal, by the people list (add_person or update_person principal=user:…). Anyone not on it is refused. The app runs it only through the @puddleworks/capture-app-step workflow, which passes the run's own login, so the app can't say who acts. whoami writes who the login is (signed-in-<nonce>); each other step runs the method the Slack app runs for it, as that person.",
      arguments: z.object({
        principal: z.string().max(300).describe(
          "The swamp serve login acting, such as user:alice. The workflow passes run.initiatedBy.",
        ),
        step: z.enum(APP_STEPS).describe("The step to take."),
        id: z.string().max(100).default("").describe(
          "The request's id; blank only for whoami and raise.",
        ),
        nonce: z.string().regex(/^[A-Za-z0-9-]{0,64}$/).default("").describe(
          "whoami only: names the signedIn data it writes, so the app finds it.",
        ),
        version: z.coerce.number().int().min(0).default(0).describe(
          "agree: the specification version shown.",
        ),
        note: reason("requestChanges: what should change."),
        reason: reason("withdraw: why it is withdrawn."),
        body: z.string().max(20_000).default("").describe(
          "reply: what it says.",
        ),
        questionId: z.string().max(100).default("").describe(
          "resolveQuestion: the question's message id.",
        ),
        result: z.string().max(200_000).default("").describe(
          "recordBuildResult: the build result's JSON or https URL.",
        ),
        specification: z.string().max(200_000).default("").describe(
          "editSpecification: the specification, as JSON text.",
        ),
        title: z.string().max(200).default("").describe("raise: the title."),
        description: z.string().max(20_000).default("").describe(
          "raise: what is wanted.",
        ),
        currentProcess: z.string().max(20_000).default("").describe(
          "raise: how it is done today.",
        ),
        phrase: z.string().max(500).default("").describe(
          "raise: the phrase someone would ask, if there is one.",
        ),
        idempotencyKey: z.string().max(200).default("").describe(
          "raise: the same key from the same person gives the same request.",
        ),
      }),
      execute: async (
        args: AppStepInput & { principal: string; nonce: string },
        context: CaptureContext,
      ): Output => {
        let call = null as ReturnType<typeof appStepCall> | null;
        const found = await run(context, async (services, store) => {
          const person = await services.signedIn(args.principal);
          if (args.step !== "whoami") {
            call = appStepCall(args, person.email);
            return;
          }
          if (!args.nonce) {
            throw new DomainError("invalid_input", "whoami needs a nonce.");
          }
          store.add(
            await context.writeResource(
              "signedIn",
              `signed-in-${args.nonce}`,
              {
                principal: args.principal,
                userId: person.userId,
                name: person.name,
                email: person.email,
                isBuilder: person.isBuilder,
              },
            ),
          );
          context.logger.info("{principal} is {name} <{email}>", {
            principal: args.principal,
            name: person.name,
            email: person.email,
          });
        });
        if (call === null) return found;
        const { method, args: input } = call;
        context.logger.info("{principal} takes {step} as {as}", {
          principal: args.principal,
          step: args.step,
          as: input.as,
        });
        return await runMethod(method, input, context);
      },
    },

    app_stand_in: {
      description:
        "After a step taken in the Capture app, say whether a stand-in agent takes its turn, as the Slack app would bring one in: on an open request one person holds both roles of, after a reply, submitting, asking for changes, editing the spec or resolving a question, with standInAgent set and a stand-in for the role in the people list. Writes stand-in-next-<id>; the @puddleworks/capture-app-step workflow then runs @puddleworks/capture-stand-in when it is due. principal must be someone in the people list.",
      arguments: z.object({
        principal: z.string().max(300).describe(
          "The swamp serve login that took the step. The workflow passes run.initiatedBy.",
        ),
        step: z.enum(APP_STEPS).describe("The step just taken."),
        id: z.string().max(100).default("").describe("The request's id."),
      }),
      execute: (
        args: { principal: string; step: AppStepInput["step"]; id: string },
        context: CaptureContext,
      ): Output =>
        run(context, async (services, store) => {
          const person = await services.signedIn(args.principal);
          const agent = context.globalArgs.standInAgent;
          const after = STAND_IN_AFTER[args.step];
          let next = null;
          if (agent && args.id && after !== undefined) {
            let point = after ?? undefined;
            if (args.step === "submit") {
              const stored = await services.get(person.email, args.id);
              const all = await store.allRequests();
              if (possibleDuplicates(stored.request, all).length > 0) {
                point = "duplicates";
              }
            }
            next = await services.standInAfter(person, args.id, point);
          }
          const id = next?.stored.request.id ?? args.id;
          store.add(
            await context.writeResource(
              "standInNext",
              `stand-in-next-${id || "none"}`,
              {
                due: next !== null,
                id,
                agent: next ? agent : "",
                standInAs: next?.standIn.email ?? "",
                point: next?.point ?? "",
              },
            ),
          );
          context.logger.info(
            next
              ? "{name} takes its turn on request #{number} after {step}"
              : "No stand-in takes a turn after {step}",
            {
              name: next?.standIn.name,
              number: next?.stored.number,
              step: args.step,
            },
          );
        }),
    },

    export_snapshot: {
      description:
        "Write everything Capture holds, people and every request whatever its sharing, to a new capture-snapshot/v1 file, so another repository can import it. The file holds people's emails.",
      arguments: z.object({
        path: z.string().min(1).describe(
          "Where to write the snapshot, relative to the repository. There must be no file there yet.",
        ),
      }),
      execute: (args: { path: string }, context: CaptureContext) =>
        run(context, async (services, store) => {
          const file = args.path.startsWith("/")
            ? args.path
            : `${context.repoDir}/${args.path}`;
          const snapshot = await services.exportSnapshot();
          try {
            await Deno.writeTextFile(
              file,
              `${JSON.stringify(snapshot, null, 2)}\n`,
              { createNew: true, mode: 0o600 },
            );
          } catch (e) {
            if (e instanceof Deno.errors.AlreadyExists) {
              throw new Error(
                `${args.path} already exists. Name a new file, so no earlier snapshot is lost.`,
              );
            }
            throw e;
          }
          store.add(
            await context.writeResource("exportResult", "export-latest", {
              path: args.path,
              people: snapshot.people.length,
              requests: snapshot.requests.length,
              exportedAt: snapshot.exportedAt,
            }),
          );
          context.logger.info(
            "Exported {people} people and {requests} requests to {path}",
            {
              people: snapshot.people.length,
              requests: snapshot.requests.length,
              path: args.path,
            },
          );
        }),
    },

    import: {
      description:
        "Bring in a capture-snapshot/v1 file, as export_snapshot or Capture's old Node app wrote. Adds only what isn't here yet, so it is safe to run again.",
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
          const text = await Deno.readTextFile(file);
          let snapshot: Snapshot;
          try {
            snapshot = JSON.parse(text);
          } catch {
            // The parser's own message can quote the file, so it isn't passed on.
            throw new DomainError(
              "invalid_input",
              `${args.path} isn't valid JSON, so nothing was imported.`,
            );
          }
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
            "Imported {peopleAdded} people and {requestsAdded} requests ({peopleSkipped} and {requestsSkipped} already here); numbered {requestsNumbered} requests; carried {loginsCarried} swamp logins and left {loginsDropped} off, as already someone's here or on a stand-in",
            { ...counts },
          );
        }),
    },
  },
};
