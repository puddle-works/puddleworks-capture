// The viewer's copy of Capture's data. It reads one requests behavior's data
// with swamp's data query and keeps the latest, so each page load answers
// from memory and the poll only says whether anything changed.
import { fromResource, recordObject } from "../capture/swamp_store.ts";
import type { Stored } from "../capture/ports.ts";
import { toWebRequest, toWebSummary } from "../capture/views.ts";
import type {
  WebOverview,
  WebPerson,
  WebRequest,
} from "../capture/view_types.ts";

export const REQUESTS_TYPE = "@puddleworks/capture/requests";

/** swamp's data query, as the method context gives it. */
export type QueryData = (predicate: string) => Promise<unknown[]>;

/** A behavior name, checked so it can't change the query it is put into. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.@\/-]*$/;

export function predicate(
  behavior: string,
  spec: "request" | "person",
): string {
  if (!NAME.test(behavior)) {
    throw new Error(`"${behavior}" isn't a behavior name`);
  }
  return `modelType == "${REQUESTS_TYPE}" && modelName == "${behavior}" && specName == "${spec}"`;
}

/** What makes two reads the same: each item's name and version. */
function fingerprint(records: unknown[]): string {
  return records
    .map((r) => {
      const { name, version } = r as { name?: unknown; version?: unknown };
      return `${name}@${version}`;
    })
    .sort()
    .join(",");
}

export interface CaptureSource {
  /** Reads again; true when something changed since the last read. */
  refresh(): Promise<boolean>;
  overview(): WebOverview;
  /** By id, or by number (12 or #12). */
  request(ref: string): WebRequest | undefined;
}

export function captureSource(
  query: QueryData,
  behavior: string,
): CaptureSource {
  let requests = new Map<string, Stored>();
  let people: WebPerson[] = [];
  let readAt = new Date(0).toISOString();
  let last: string | null = null;

  return {
    async refresh() {
      const [requestRecords, personRecords] = await Promise.all([
        query(predicate(behavior, "request")),
        query(predicate(behavior, "person")),
      ]);
      readAt = new Date().toISOString();
      const print = `${fingerprint(requestRecords)}|${
        fingerprint(personRecords)
      }`;
      if (print === last) return false;
      last = print;
      const nextRequests = new Map<string, Stored>();
      for (const record of requestRecords) {
        const data = recordObject(record as never);
        // One a page can't read is left out, not the end of the page.
        if (data && typeof data.id === "string") {
          nextRequests.set(data.id, fromResource(data));
        }
      }
      requests = nextRequests;
      people = personRecords
        .map((r) => recordObject(r as never))
        .filter((d): d is Record<string, unknown> =>
          d !== null && typeof d.email === "string"
        )
        .map((d) => ({
          name: String(d.name),
          email: String(d.email),
          isBuilder: d.isBuilder === true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return true;
    },

    overview() {
      const summaries = [...requests.values()]
        .map(toWebSummary)
        .sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)
        );
      return { requests: summaries, people, readAt };
    },

    request(ref) {
      const number = /^#?(\d+)$/.exec(ref)?.[1];
      const stored = number === undefined
        ? requests.get(ref)
        : [...requests.values()].find((s) => s.number === Number(number));
      return stored && toWebRequest(stored);
    },
  };
}
