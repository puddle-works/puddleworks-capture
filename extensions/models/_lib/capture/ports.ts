// What the use cases need from storage. swamp_store.ts keeps it in swamp
// data; memory_store.ts keeps it in memory for the tests.
import type { Person, Request } from "../domain/model.ts";

/** What an imported request was before Capture: its old name, state and state changes. */
export interface OldHistory {
  name: string;
  state: string;
  transitions: {
    from: string | null;
    to: string;
    at: string;
    note: string | null;
  }[];
}

/** A key a caller sent with create_request, so a retry gives back the same request. */
export interface IdempotencyKey {
  userId: string;
  key: string;
}

/** A request as saved, with what Capture keeps beside it. */
export interface Stored {
  request: Request;
  /** One more for every saved change. */
  version: number;
  idempotencyKeys: IdempotencyKey[];
  /** Set for a request brought in from the old Puddleworks app. */
  before: OldHistory | null;
  /** What the old app had that Capture has no place for, kept whole. */
  legacy: unknown;
  /**
   * What people call it: 1 for the first request, then one more for each.
   * Null for one saved before requests had numbers, until it is given one.
   */
  number: number | null;
}

export interface CaptureStore {
  getRequest(id: string): Promise<Stored | undefined>;
  allRequests(): Promise<Stored[]>;
  saveRequest(stored: Stored): Promise<void>;
  allPeople(): Promise<Person[]>;
  savePerson(person: Person): Promise<void>;
}
