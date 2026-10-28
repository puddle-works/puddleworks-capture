// The store kept in swamp data: one `request` resource per request
// (`request-<id>`) and one `person` resource per person (`person-<id>`), each
// saved change a new version. It remembers what it wrote, so a method reads
// its own writes, and hands swamp the data handles to return.
import { type Person, type Request, upgradeRequest } from "../domain/index.ts";
import type { CaptureStore, Stored } from "./ports.ts";

export const REQUEST_SPEC = "request";
export const PERSON_SPEC = "person";

/** One data item as swamp reads it back. */
export interface DataRecord {
  name: string;
  attributes?: unknown;
  content?: unknown;
}

/** The part of swamp's method context the store uses. */
export interface StoreContext {
  definition: { name: string };
  writeResource(
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ): Promise<{ name: string }>;
  readResource(name: string): Promise<Record<string, unknown> | null>;
  readModelData(modelName: string, specName?: string): Promise<DataRecord[]>;
}

/** A record's JSON, however this swamp hands it over. */
export function recordObject(
  record: DataRecord,
): Record<string, unknown> | null {
  const value = record.attributes ?? record.content;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

export const requestName = (id: string) => `request-${id}`;
export const personName = (userId: string) => `person-${userId}`;

/** The resource saved for a request: the request's own fields at the top, so `.id` and `.status` read directly. */
export function toResource(stored: Stored): Record<string, unknown> {
  return {
    ...stored.request,
    version: stored.version,
    idempotencyKeys: stored.idempotencyKeys,
    before: stored.before,
    legacy: stored.legacy ?? null,
    number: stored.number,
  };
}

export function fromResource(data: Record<string, unknown>): Stored {
  const { version, idempotencyKeys, before, legacy, number, ...request } = data;
  return {
    // An older Capture may have saved it as exported.
    request: upgradeRequest(request as unknown as Request),
    version: Number(version ?? 1),
    idempotencyKeys: (idempotencyKeys ?? []) as Stored["idempotencyKeys"],
    before: (before ?? null) as Stored["before"],
    legacy: legacy ?? null,
    number: typeof number === "number" ? number : null,
  };
}

function toPerson(data: Record<string, unknown>): Person {
  return {
    userId: String(data.userId),
    name: String(data.name),
    email: String(data.email),
    isBuilder: data.isBuilder === true,
  };
}

export class SwampStore implements CaptureStore {
  /** Data handles for everything written, in order, each name once. */
  readonly handles: { name: string }[] = [];
  private readonly requests = new Map<string, Stored>();
  private readonly people = new Map<string, Person>();

  constructor(private readonly context: StoreContext) {}

  private remember(handle: { name: string }) {
    if (!this.handles.some((h) => h.name === handle.name)) {
      this.handles.push(handle);
    }
  }

  async getRequest(id: string): Promise<Stored | undefined> {
    const written = this.requests.get(id);
    if (written) return structuredClone(written);
    const data = await this.context.readResource(requestName(id));
    return data ? fromResource(data) : undefined;
  }

  async allRequests(): Promise<Stored[]> {
    const found = new Map<string, Stored>();
    for (
      const record of await this.context.readModelData(
        this.context.definition.name,
        REQUEST_SPEC,
      )
    ) {
      const data = recordObject(record);
      if (data && typeof data.id === "string") {
        found.set(data.id, fromResource(data));
      }
    }
    for (const [id, stored] of this.requests) {
      found.set(id, structuredClone(stored));
    }
    return [...found.values()];
  }

  async saveRequest(stored: Stored): Promise<void> {
    this.remember(
      await this.context.writeResource(
        REQUEST_SPEC,
        requestName(stored.request.id),
        toResource(stored),
      ),
    );
    this.requests.set(stored.request.id, structuredClone(stored));
  }

  async allPeople(): Promise<Person[]> {
    const found = new Map<string, Person>();
    for (
      const record of await this.context.readModelData(
        this.context.definition.name,
        PERSON_SPEC,
      )
    ) {
      const data = recordObject(record);
      if (data && typeof data.userId === "string") {
        found.set(data.userId, toPerson(data));
      }
    }
    for (const [id, person] of this.people) found.set(id, { ...person });
    return [...found.values()];
  }

  async savePerson(person: Person): Promise<void> {
    this.remember(
      await this.context.writeResource(PERSON_SPEC, personName(person.userId), {
        ...person,
      }),
    );
    this.people.set(person.userId, { ...person });
  }

  /** Whether this run has written the request already. */
  wrote(id: string): boolean {
    return this.requests.has(id);
  }

  /** Records a handle for something written outside the store. */
  add(handle: { name: string }) {
    this.remember(handle);
  }
}
