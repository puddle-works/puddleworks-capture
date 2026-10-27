// The use cases. Each names who is acting by email, loads a request, applies
// one domain rule and saves it; the rules themselves live in ../domain. swamp
// runs one method of a behavior at a time, so nobody else can save between
// the load and the save.
import {
  agree,
  canRead,
  createRequest,
  decline,
  DomainError,
  editDetails,
  editSpecification,
  type ExportFormat,
  inviteParticipant,
  joinAsBuilder,
  latestSpecification,
  type Message,
  type NewRequest,
  type OutcomeSpecV1,
  type Participant,
  type Person,
  postMessage,
  propose,
  recordExport,
  recordReview,
  removeParticipant,
  type Request,
  requestChanges,
  type RequestDetails,
  type RequestStatus,
  resolveQuestion,
  type Review,
  reviewPrompt,
  reviewVersion,
  revise,
  type Role,
  roleOf,
  specHashInput,
  type SpecificationContent,
  submit,
  toMarkdown,
  toOutcomeSpecV1,
  withdraw,
} from "../domain/index.ts";
import type { CaptureStore, Stored } from "./ports.ts";
import {
  type ImportCounts,
  type Snapshot,
  SnapshotSchema,
} from "./snapshot.ts";

export interface ServiceDeps {
  store: CaptureStore;
  /** Now, as an ISO 8601 string. */
  clock: () => string;
  newId: () => string;
  /** Where the request pages are, with no trailing slash. */
  appUrl: string;
}

/** Statuses a builder could still join a request in. */
const OPEN: readonly RequestStatus[] = [
  "discussing",
  "ready_for_agreement",
  "agreed",
  "exported",
];

/** The specification's ETag: changes whenever the current version is edited or moves on. */
export function specificationEtag(request: Request): string {
  const spec = latestSpecification(request);
  return spec
    ? `"v${spec.version}-${spec.status}-${spec.updatedAt}"`
    : `"none"`;
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The number in a reference such as "12" or "#12"; undefined for an id. */
function numberIn(ref: string): number | undefined {
  const found = /^#?(\d+)$/.exec(ref.trim());
  return found ? Number(found[1]) : undefined;
}

/** Oldest first; the id breaks a tie so the order is always the same. */
function oldestFirst(a: Stored, b: Stored): number {
  const at = a.request.createdAt.localeCompare(b.request.createdAt);
  return at !== 0 ? at : a.request.id.localeCompare(b.request.id);
}

/** Newest change first; the id breaks a tie so the order is always the same. */
function newestFirst(a: Stored, b: Stored): number {
  const at = b.request.updatedAt.localeCompare(a.request.updatedAt);
  return at !== 0 ? at : b.request.id.localeCompare(a.request.id);
}

export type Services = ReturnType<typeof createServices>;

export function createServices({ store, clock, newId, appUrl }: ServiceDeps) {
  async function personByEmail(email: string): Promise<Person | undefined> {
    const wanted = email.trim().toLowerCase();
    return (await store.allPeople()).find((p) => p.email === wanted);
  }

  /** Who `email` is. Capture acts only for people in its people list. */
  async function actor(email: string): Promise<Person> {
    const person = await personByEmail(email);
    if (!person) {
      throw new DomainError(
        "not_found",
        `${email} isn't in Capture's people list. Add them with add_person, then try again.`,
      );
    }
    return person;
  }

  /** A request by its number (12 or #12) or its id. */
  async function find(ref: string): Promise<Stored | undefined> {
    const number = numberIn(ref);
    if (number === undefined) return store.getRequest(ref);
    return (await store.allRequests()).find((s) => s.number === number);
  }

  /**
   * Gives every request without a number one, oldest first, after the
   * highest already given, and saves it; `adding` are new ones not saved
   * yet, so each is saved once. Numbering isn't a change to the request, so
   * its version stays as it was. Says how many it numbered and the next number.
   */
  async function numberRequests(
    adding: Stored[] = [],
  ): Promise<{ numbered: number; next: number }> {
    const all = [...await store.allRequests(), ...adding];
    let last = Math.max(0, ...all.map((s) => s.number ?? 0));
    const waiting = all.filter((s) => s.number === null).sort(oldestFirst);
    for (const stored of waiting) {
      await store.saveRequest({ ...stored, number: ++last });
    }
    return { numbered: waiting.length, next: last + 1 };
  }

  async function load(person: Person, ref: string): Promise<Stored> {
    const stored = await find(ref);
    // A request you can't see answers as missing, so its existence isn't leaked.
    if (!stored || !canRead(stored.request, person)) {
      throw new DomainError(
        "not_found",
        "There is no such request, or it isn't shared with you.",
      );
    }
    return stored;
  }

  /** Load, change, save. A change that leaves the request as it was saves nothing. */
  async function mutate(
    as: string,
    id: string,
    change: (
      request: Request,
      person: Person,
      at: string,
    ) => Request | Promise<Request>,
  ): Promise<Stored> {
    const person = await actor(as);
    const stored = await load(person, id);
    const next = await change(stored.request, person, clock());
    if (next === stored.request) return stored;
    const saved = { ...stored, request: next, version: stored.version + 1 };
    await store.saveRequest(saved);
    return saved;
  }

  return {
    async addPerson(
      input: { email: string; name: string; builder: boolean },
    ): Promise<Person> {
      const email = input.email.trim().toLowerCase();
      if (await personByEmail(email)) {
        throw new DomainError(
          "invalid_input",
          `${email} is already in the people list; change them with update_person.`,
        );
      }
      const person: Person = {
        userId: newId(),
        name: input.name.trim(),
        email,
        isBuilder: input.builder,
      };
      await store.savePerson(person);
      return person;
    },

    /** Changes the people list only: requests keep the name someone had when they joined. */
    async updatePerson(
      input: { email: string; name?: string; builder?: boolean },
    ): Promise<Person> {
      const found = await actor(input.email);
      const person: Person = {
        ...found,
        name: input.name?.trim() ?? found.name,
        isBuilder: input.builder ?? found.isBuilder,
      };
      await store.savePerson(person);
      return person;
    },

    actor,

    async create(
      as: string,
      input: Omit<NewRequest, "id">,
      idempotencyKey?: string,
    ): Promise<{ stored: Stored; created: boolean }> {
      const person = await actor(as);
      const { next } = await numberRequests();
      if (idempotencyKey !== undefined) {
        const earlier = (await store.allRequests()).find((s) =>
          s.idempotencyKeys.some((k) =>
            k.userId === person.userId && k.key === idempotencyKey
          )
        );
        if (earlier) return { stored: earlier, created: false };
      }
      const stored: Stored = {
        request: createRequest({ ...input, id: newId() }, person, clock()),
        version: 1,
        idempotencyKeys: idempotencyKey === undefined
          ? []
          : [{ userId: person.userId, key: idempotencyKey }],
        before: null,
        legacy: null,
        number: next,
      };
      await store.saveRequest(stored);
      return { stored, created: true };
    },

    async get(as: string, id: string): Promise<Stored> {
      return load(await actor(as), id);
    },

    async list(
      as: string,
      query: {
        scope: "mine" | "available";
        status?: RequestStatus;
        max: number;
      },
    ): Promise<{ items: Stored[]; truncated: boolean }> {
      const person = await actor(as);
      if (query.scope === "available" && !person.isBuilder) {
        throw new DomainError(
          "not_allowed",
          "Only builders can browse requests to join.",
        );
      }
      const found = (await store.allRequests())
        .filter(({ request }) => {
          const on = roleOf(request, person.userId) !== undefined;
          const inScope = query.scope === "mine"
            ? on
            : !on && OPEN.includes(request.status);
          return inScope &&
            (query.status === undefined || request.status === query.status);
        })
        .sort(newestFirst);
      return {
        items: found.slice(0, query.max),
        truncated: found.length > query.max,
      };
    },

    editDetails: (as: string, id: string, details: RequestDetails) =>
      mutate(as, id, (r, p, at) => editDetails(r, p, details, at)),
    submit: (as: string, id: string) =>
      mutate(as, id, (r, p, at) => submit(r, p, at)),
    withdraw: (as: string, id: string, reason: string) =>
      mutate(as, id, (r, p, at) => withdraw(r, p, reason, at)),
    decline: (as: string, id: string, reason: string) =>
      mutate(as, id, (r, p, at) => decline(r, p, reason, at)),
    propose: (as: string, id: string) =>
      mutate(as, id, (r, p, at) => propose(r, p, at)),
    requestChanges: (as: string, id: string, note: string) =>
      mutate(as, id, (r, p, at) => requestChanges(r, p, note, at)),
    revise: (as: string, id: string) =>
      mutate(as, id, (r, p, at) => revise(r, p, at)),
    join: (as: string, id: string) =>
      mutate(as, id, (r, p, at) => joinAsBuilder(r, p, at)),

    async invite(
      as: string,
      id: string,
      { email, role }: { email: string; role: Exclude<Role, "outcome_owner"> },
    ): Promise<{ stored: Stored; participant: Participant }> {
      const invitee = await personByEmail(email);
      if (!invitee) {
        // Checked after the inviter can see the request, so the answer leaks nothing.
        await load(await actor(as), id);
        throw new DomainError(
          "not_found",
          `${email} isn't in Capture's people list yet. Add them with add_person, then invite them.`,
        );
      }
      const stored = await mutate(
        as,
        id,
        (r, p, at) => inviteParticipant(r, p, invitee, role, at),
      );
      return {
        stored,
        participant: stored.request.participants.find((p) =>
          p.userId === invitee.userId
        )!,
      };
    },

    /** By the email they joined with, so it works for someone since dropped from the people list. */
    removeParticipant: (as: string, id: string, email: string) =>
      mutate(as, id, (r, p, at) => {
        const wanted = email.trim().toLowerCase();
        const leaving = r.participants.find((x) =>
          x.email.toLowerCase() === wanted
        );
        if (!leaving) {
          throw new DomainError("not_found", `${email} isn't on this request.`);
        }
        return removeParticipant(r, p, leaving.userId, at);
      }),

    async postMessage(
      as: string,
      id: string,
      input: { kind: Message["kind"]; body: string },
    ): Promise<{ stored: Stored; message: Message }> {
      const messageId = newId();
      const stored = await mutate(
        as,
        id,
        (r, p, at) => postMessage(r, p, { ...input, id: messageId }, at),
      );
      return {
        stored,
        message: stored.request.messages.find((m) => m.id === messageId)!,
      };
    },

    async resolveQuestion(
      as: string,
      id: string,
      messageId: string,
      resolutionMessageId: string | null,
    ): Promise<{ stored: Stored; message: Message }> {
      const stored = await mutate(
        as,
        id,
        (r, p, at) => resolveQuestion(r, p, messageId, resolutionMessageId, at),
      );
      return {
        stored,
        message: stored.request.messages.find((m) => m.id === messageId)!,
      };
    },

    /** `ifMatch` is the specification ETag the editor read; null skips the check. */
    editSpecification: (
      as: string,
      id: string,
      { content, basedOnMessageIds }: {
        content: SpecificationContent;
        basedOnMessageIds: string[];
      },
      ifMatch: string | null,
    ) =>
      mutate(as, id, (r, p, at) => {
        if (ifMatch !== null && ifMatch !== specificationEtag(r)) {
          throw new DomainError(
            "invalid_state",
            "The specification has changed since you opened it. Read it again, then make your change again.",
          );
        }
        return editSpecification(r, p, content, basedOnMessageIds, at);
      }),

    /** The prompt for a reviewer of the spec up for agreement, and its version. */
    async reviewPrompt(
      as: string,
      id: string,
    ): Promise<{ stored: Stored; version: number; prompt: string }> {
      const person = await actor(as);
      const stored = await load(person, id);
      const version = reviewVersion(stored.request, person);
      return { stored, version, prompt: reviewPrompt(stored.request) };
    },

    /** `version`, when given, is the one reviewed; a newer one refuses it. */
    recordReview: (
      as: string,
      id: string,
      review: Review,
      version?: number,
    ) =>
      mutate(
        as,
        id,
        (r, p, at) => recordReview(r, p, review, { newId, version }, at),
      ),

    agree: (as: string, id: string, version: number) =>
      mutate(as, id, async (r, p, at) => {
        // An unknown version is refused by agree() as not the one up for agreement.
        const spec = r.specifications.find((s) => s.version === version);
        return agree(r, p, {
          version,
          specHash: spec ? await sha256(specHashInput(spec.content)) : "",
        }, at);
      }),

    async export(
      as: string,
      id: string,
      format: ExportFormat,
    ): Promise<{ stored: Stored; document: OutcomeSpecV1 | string }> {
      const stored = await mutate(
        as,
        id,
        (r, p, at) => recordExport(r, p, format, at),
      );
      // The request's page: the viewer serves it at this path.
      const doc = toOutcomeSpecV1(
        stored.request,
        stored.request.updatedAt,
        `${appUrl}/requests/${stored.request.id}`,
      );
      return {
        stored,
        document: format === "markdown" ? toMarkdown(doc) : doc,
      };
    },

    /**
     * Adds what isn't here yet: a person by email or id, a request by id.
     * Then numbers what has no number. Safe to run again.
     */
    async importSnapshot(snapshot: Snapshot): Promise<ImportCounts> {
      const parsed = SnapshotSchema.safeParse(snapshot);
      if (!parsed.success) {
        throw new DomainError(
          "invalid_input",
          `That isn't a capture-snapshot/v1 file: ${parsed.error.message}`,
        );
      }
      const counts: ImportCounts = {
        peopleAdded: 0,
        peopleSkipped: 0,
        requestsAdded: 0,
        requestsSkipped: 0,
        requestsNumbered: 0,
      };
      const people = await store.allPeople();
      for (const incoming of snapshot.people) {
        const email = incoming.email.trim().toLowerCase();
        if (
          people.some((p) => p.email === email || p.userId === incoming.userId)
        ) {
          counts.peopleSkipped++;
          continue;
        }
        const person = { ...incoming, email };
        await store.savePerson(person);
        people.push(person);
        counts.peopleAdded++;
      }
      const adding: Stored[] = [];
      for (const incoming of parsed.data.requests) {
        if (
          await store.getRequest(incoming.request.id) ||
          adding.some((s) => s.request.id === incoming.request.id)
        ) {
          counts.requestsSkipped++;
          continue;
        }
        adding.push({
          ...incoming,
          request: incoming.request as unknown as Request,
          number: null,
        });
        counts.requestsAdded++;
      }
      counts.requestsNumbered = (await numberRequests(adding)).numbered;
      return counts;
    },
  };
}
