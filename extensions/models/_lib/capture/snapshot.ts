// capture-snapshot/v1: everything Capture's old Node app held, as one JSON
// file, so the import method can bring it into swamp data.
import { z } from "npm:zod@4.6.5";
import type { Person } from "../domain/index.ts";
import type { Stored } from "./ports.ts";

const PersonSchema = z.object({
  userId: z.string().min(1),
  name: z.string(),
  email: z.string().min(1),
  isBuilder: z.boolean(),
});

// The request itself was checked by the domain when it was made; the import
// trusts its shape beyond the fields it reads.
const StoredSchema = z.object({
  request: z.looseObject({
    id: z.string().min(1),
    status: z.string(),
    outcomeOwnerId: z.string(),
  }),
  version: z.number().int().min(1),
  idempotencyKeys: z.array(z.object({ userId: z.string(), key: z.string() }))
    .default([]),
  before: z
    .object({
      name: z.string(),
      state: z.string(),
      transitions: z.array(
        z.object({
          from: z.string().nullable(),
          to: z.string(),
          at: z.string(),
          note: z.string().nullable(),
        }),
      ),
    })
    .nullable()
    .default(null),
  legacy: z.unknown().default(null),
});

export const SnapshotSchema = z.object({
  format: z.literal("capture-snapshot/v1"),
  exportedAt: z.string(),
  people: z.array(PersonSchema),
  requests: z.array(StoredSchema),
});

export interface Snapshot {
  format: "capture-snapshot/v1";
  exportedAt: string;
  people: Person[];
  // The Node app had no numbers; the import gives them out.
  requests: Omit<Stored, "number">[];
}

export interface ImportCounts {
  peopleAdded: number;
  peopleSkipped: number;
  requestsAdded: number;
  requestsSkipped: number;
  /** Requests given a number: those brought in, and any here without one. */
  requestsNumbered: number;
}
