// Stand-in agents: when one person is both the requester (the outcome owner)
// and the builder, an agent takes the role they aren't playing, so the
// request is still discussed by two sides. Which role the person plays is one
// rule, personPlays. The agents talk, draft and propose; every decision stays
// with the person, which permissions.ts enforces for any stand-in.
import { z } from "npm:zod@4.6.5";
import { currentBuild, routerTestFor } from "./build.ts";
import { openQuestions, postMessage } from "./discussion.ts";
import { DomainError } from "./errors.ts";
import { isClosed, statusWords } from "./lifecycle.ts";
import {
  type Person,
  type Request,
  type RequestStatus,
  SpecificationContentSchema,
  type StandInRole,
} from "./model.ts";
import { participantOf } from "./permissions.ts";
import { recipeProblems } from "./recipe.ts";
import {
  BUILT_FROM_AGREED,
  editSpecification,
  latestAgreed,
  latestSpecification,
  propose,
  reviseSpecification,
} from "./specification.ts";

/** Where the requester and the builder normally discuss a request. */
export const DISCUSSION_POINTS = [
  "clarify",
  "recipe",
  "effects",
  "open_questions",
  "proposal",
  "revision",
  "router_test",
  "duplicates",
] as const;
export type DiscussionPoint = (typeof DISCUSSION_POINTS)[number];

const POINT_WORDS: Record<DiscussionPoint, string> = {
  clarify: "clarifying the request: what is wanted and how it is done today",
  recipe:
    "writing the recipe: its example phrases, what each answer shows, and what to answer when there is nothing to show (whenEmpty)",
  effects:
    "reads or writes: whether the outcome only reads, or what it changes (effects)",
  open_questions: "answering the open questions before it can be agreed",
  proposal:
    "the proposed specification: proposing, asking for changes, and proposing again",
  revision: "a revision of the agreed specification, and its reason",
  router_test: "a router test after release that didn't answer every phrase",
  duplicates:
    "possible duplicates of this request, and whether to cut its scope or withdraw it",
};

const BEFORE_AGREED: readonly RequestStatus[] = [
  "draft",
  "discussing",
  "ready_for_agreement",
];

/**
 * The rule: which role a person who is both requester and builder plays
 * now. Until the spec is agreed they are the requester; from Agreed on they
 * are the builder. A revision of an agreed spec is the builder's, so while
 * it waits for agreement the requester agent challenges it. Duplicates and
 * scope follow the phase like the rest.
 */
export function personPlays(
  status: RequestStatus,
  point: DiscussionPoint,
): StandInRole {
  return BEFORE_AGREED.includes(status) && point !== "revision"
    ? "requester"
    : "builder";
}

/** The role the stand-in agent takes: the one the person isn't playing. */
export function standInRole(
  status: RequestStatus,
  point: DiscussionPoint,
): StandInRole {
  return personPlays(status, point) === "requester" ? "builder" : "requester";
}

/**
 * Whether one person holds both roles: the outcome owner is a builder in the
 * people list, and no other person (stand-ins aside) builds on the request.
 */
export function heldByOnePerson(request: Request, people: Person[]): boolean {
  const byId = new Map(people.map((p) => [p.userId, p]));
  if (!byId.get(request.outcomeOwnerId)?.isBuilder) return false;
  return !request.participants.some((p) =>
    p.role === "builder" && p.userId !== request.outcomeOwnerId &&
    !byId.get(p.userId)?.standIn
  );
}

/**
 * Throws unless `standIn` may take a turn on the request now: it is a
 * stand-in, one person holds both roles, the request is open, and the rule
 * gives this stand-in's role.
 */
export function requireStandInTurn(
  request: Request,
  people: Person[],
  standIn: Person,
  point: DiscussionPoint,
): void {
  if (!standIn.standIn) {
    throw new DomainError(
      "not_allowed",
      `${standIn.name} isn't a stand-in agent.`,
    );
  }
  if (!heldByOnePerson(request, people)) {
    throw new DomainError(
      "not_allowed",
      "The requester and the builder are different people, so no stand-in agent joins.",
    );
  }
  if (request.status === "draft" || isClosed(request)) {
    throw new DomainError(
      "invalid_state",
      `The request is ${
        statusWords(request.status)
      }, so there is no discussion to join.`,
    );
  }
  const wanted = standInRole(request.status, point);
  if (standIn.standIn !== wanted) {
    throw new DomainError(
      "not_allowed",
      `While the request is ${statusWords(request.status)} the person is the ${
        personPlays(request.status, point)
      }, so the ${wanted} agent takes part, not the ${standIn.standIn} agent.`,
    );
  }
}

/** The stand-in on the request: the builder agent builds, the requester agent reviews. */
export function joinAsStandIn(
  request: Request,
  standIn: Person,
  at: string,
): Request {
  if (participantOf(request, standIn.userId)) return request;
  return {
    ...request,
    updatedAt: at,
    participants: [...request.participants, {
      userId: standIn.userId,
      name: standIn.name,
      email: standIn.email,
      role: standIn.standIn === "builder" ? "builder" : "reviewer",
      invitedBy: null,
      joinedAt: at,
    }],
  };
}

/** The outcome owner's router test of the current build's published version. */
function latestRouterTest(request: Request) {
  return routerTestFor(
    request,
    currentBuild(request)?.result.published?.version,
  );
}

/** Where the discussion is, for a stand-in asked without saying. */
export function currentPoint(request: Request): DiscussionPoint {
  const latest = latestSpecification(request);
  const agreed = latestAgreed(request);
  if (request.status === "building" || request.status === "released") {
    const test = latestRouterTest(request);
    if (test?.results.some((r) => r.outcome === "not-answered")) {
      return "router_test";
    }
  }
  if (
    latest?.changeSummary && agreed && latest.version > agreed.version &&
    !BUILT_FROM_AGREED.includes(request.status)
  ) {
    return "revision";
  }
  if (openQuestions(request).length > 0) return "open_questions";
  if (request.status === "ready_for_agreement") return "proposal";
  if (request.transitions.at(-1)?.action === "requestChanges") {
    return "proposal";
  }
  const content = latest?.content;
  if (!content || !content.problemStatement.trim()) return "clarify";
  if (recipeProblems(content, request.requestedPhrase).length > 0) {
    return "recipe";
  }
  if (!content.effects) return "effects";
  return "proposal";
}

const STOP = new Set(
  "a an and are for from have how into is it its of on or our that the this to we what when which with week each every"
    .split(" "),
);

function words(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((w) =>
      w.length > 2 && !STOP.has(w)
    ),
  );
}

/** Other open requests asking for much the same, by the words of their titles and phrases. */
export function possibleDuplicates(
  request: Request,
  others: { number: number | null; request: Request }[],
): { number: number | null; title: string; status: RequestStatus }[] {
  const mine = words(`${request.title} ${request.requestedPhrase ?? ""}`);
  return others
    .filter(({ request: r }) =>
      r.id !== request.id && r.status !== "draft" && !isClosed(r)
    )
    .filter(({ request: r }) => {
      const theirs = words(`${r.title} ${r.requestedPhrase ?? ""}`);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      return shared >= 2 && shared / Math.min(mine.size, theirs.size) >= 0.5;
    })
    .slice(0, 5)
    .map(({ number, request: r }) => ({
      number,
      title: r.title,
      status: r.status,
    }));
}

/** What a stand-in may say and do in one turn. Anything else is refused. */
export const StandInTurnSchema = z.object({
  messages: z.array(z.object({
    kind: z.enum(["comment", "question"]),
    body: z.string().trim().min(1).max(4_000),
  })).max(5).default([]),
  /** The builder agent's draft of the whole specification. */
  specification: SpecificationContentSchema.nullish(),
  /** The builder agent proposes the specification for agreement. */
  propose: z.boolean().default(false),
  /** Why, when the builder agent revises an agreed specification. */
  revisionReason: z.string().trim().max(2_000).default(""),
});
export type StandInTurn = z.input<typeof StandInTurnSchema>;

/**
 * Applies a stand-in's turn: its messages, then the builder agent's draft or
 * revision and proposal. A draft or proposal the rules refuse is said as a
 * comment instead, so what the agent said isn't lost; one the stand-in isn't
 * allowed is refused outright. Call requireStandInTurn first.
 */
export function recordStandInTurn(
  request: Request,
  standIn: Person,
  turn: StandInTurn,
  { newId }: { newId: () => string },
  at: string,
): Request {
  const parsed = StandInTurnSchema.safeParse(turn);
  if (!parsed.success) {
    throw new DomainError(
      "invalid_input",
      `That isn't a stand-in turn: ${
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" ")
      }`,
    );
  }
  const { messages, specification, propose: proposing, revisionReason } =
    parsed.data;
  if (
    standIn.standIn === "requester" &&
    (specification || proposing || revisionReason)
  ) {
    throw new DomainError(
      "not_allowed",
      "The requester agent answers and challenges; it doesn't draft, propose or revise the specification.",
    );
  }
  let next = joinAsStandIn(request, standIn, at);
  for (const m of messages) {
    next = postMessage(next, standIn, { id: newId(), ...m }, at);
  }
  const refused = (what: string, e: unknown) => {
    if (
      !(e instanceof DomainError) || e.code === "not_allowed" ||
      e.code === "not_found"
    ) throw e;
    next = postMessage(next, standIn, {
      id: newId(),
      kind: "comment",
      body: `I couldn't ${what}: ${e.message}`,
    }, at);
  };
  const latest = latestSpecification(next);
  if (specification && BUILT_FROM_AGREED.includes(next.status)) {
    try {
      next = reviseSpecification(next, standIn, {
        content: specification,
        reason: revisionReason,
        basedOnVersion: latest?.version ?? 0,
      }, at);
    } catch (e) {
      refused("propose the revision", e);
    }
    return next;
  }
  if (specification) {
    try {
      next = editSpecification(next, standIn, specification, [], at);
    } catch (e) {
      refused("save the specification", e);
    }
  }
  if (proposing && next.status === "discussing") {
    try {
      next = propose(next, standIn, at);
    } catch (e) {
      refused("propose it", e);
    }
  }
  return next;
}

const bullets = (items: string[]) =>
  items.length === 0 ? "(none)" : items.map((s) => `- ${s}`).join("\n");

const ROLE_BRIEF: Record<StandInRole, string> = {
  builder:
    `You take the builder's part. Ask about the current process wherever the request leaves it unclear. Draft the recipe: the phrases someone will ask (the requested phrase stays first, as asked), what each answer shows, what to answer when there is nothing to show (whenEmpty), and any pieces taken from the phrase. Say whether the outcome only reads or what it changes (effects). Answer the requester's questions. When the specification is ready and no question is open, propose it. If an agreed specification has to change, revise it and give the reason.

Return the whole specification in "specification" whenever you change it. It says what, not how: no data shapes, libraries or file names.`,
  requester:
    `You take the requester's part. Answer from the request as written: its title, description, current process and requested phrase. Don't invent needs; when the request doesn't say, say that, and ask the person. Challenge the recipe: would the requester ask those phrases, does each answer show what was asked for, and does whenEmpty say something useful? Challenge the reads-or-writes section: does it name every change, and is "read" really only reading? Flag anything in the specification or the build that drifts from what was asked.

You don't edit the specification: leave "specification" null, "propose" false and "revisionReason" empty.`,
};

/** What a stand-in is asked: its part, the request as written, and how to answer. */
export function standInPrompt(
  request: Request,
  standIn: Person,
  point: DiscussionPoint,
  duplicates: ReturnType<typeof possibleDuplicates>,
): string {
  const role = standIn.standIn!;
  const latest = latestSpecification(request);
  const agreed = latestAgreed(request);
  const test = latestRouterTest(request);
  const said = request.messages.map((m) =>
    `- [${m.kind}${
      m.kind === "question" ? (m.resolvedAt ? ", resolved" : ", open") : ""
    }] ${m.authorName}: ${m.body}`
  );
  return `You are ${standIn.name}, a stand-in agent on a Capture request. The person who raised this request is both its requester and its builder. While it is ${
    statusWords(request.status)
  } they play the ${
    personPlays(request.status, point)
  }, so you take the ${role}'s part and discuss it with them.

The person decides; you don't. You may ask, answer, draft and propose. You can't agree, accept a revision, ask for changes, resolve a question, record a build or a router test, withdraw the request or close it as a duplicate: Capture refuses those from you. When one of those is due, say so and leave it to the person.

${ROLE_BRIEF[role]}

Now: ${POINT_WORDS[point]}.

Say only what moves the request on, briefly, as one colleague to another. A "question" must be answered before the specification can be agreed, so use it only for something that must be settled; everything else is a "comment". Say nothing when there is nothing to add.

Answer with one JSON object and nothing else:

{
  "messages": [{ "kind": "comment | question", "body": "…" }],
  "specification": null,
  "propose": false,
  "revisionReason": ""
}

"specification", when you give one, has problemStatement, desiredOutcome, scope { in, out }, constraints, assumptions, acceptanceCriteria [{ id, text }], recipe { examples [{ phrase, answer }], pieces [{ name, shape: int | repo | word }], whenEmpty, candidateExtensions } and effects { kind: read | write, changes }.

The request, as written

Request: ${request.title}
Status: ${statusWords(request.status)}

Description:
${request.initialDescription || "(none)"}

Current process:
${request.currentProcess || "(not said)"}

Requested phrase: ${request.requestedPhrase ?? "(none)"}

The specification${
    latest ? `, version ${latest.version} (${latest.status})` : ""
  }${agreed ? `; version ${agreed.version} is agreed` : ""}:
${latest ? JSON.stringify(latest.content, null, 2) : "(none yet)"}
${latest?.changeSummary ? `\nWhy it changed: ${latest.changeSummary}\n` : ""}
The discussion so far:
${bullets(said)}
${
    test
      ? `\nThe latest router test, of version ${test.version}:\n${
        bullets(test.results.map((r) =>
          `${r.phrase}: ${r.outcome}${r.note ? ` (${r.note})` : ""}`
        ))
      }\n`
      : ""
  }${
    duplicates.length > 0
      ? `\nOpen requests that may ask for the same:\n${
        bullets(duplicates.map((d) =>
          `#${d.number ?? "?"} ${d.title} (${statusWords(d.status)})`
        ))
      }\n`
      : ""
  }`;
}
