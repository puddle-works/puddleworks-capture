// Capture's data, read through the dashboard with data.query: the same
// reader the web behavior's serve method uses, given swamp's query over the
// bridge in place of the method context's.
import type { DataRecord, SwampClient } from "@swamp-club/app-sdk";
import {
  type CaptureSource,
  captureSource,
  REQUESTS_TYPE,
} from "../../../models/_lib/web/source.ts";

export { REQUESTS_TYPE };

/** Records per page; a query is read page by page until it has them all. */
const PAGE = 500;

/** Every record matching the predicate, the latest version of each. */
export async function queryAll(
  client: SwampClient,
  predicate: string,
): Promise<DataRecord[]> {
  const found: DataRecord[] = [];
  let cursor: string | undefined;
  do {
    const reply = await client.request<{
      data: { results: DataRecord[]; nextCursor?: string };
    }>("data.query", {
      predicate,
      limit: PAGE,
      sort: { field: "createdAt", direction: "asc" },
      ...(cursor !== undefined ? { cursor } : {}),
    });
    found.push(...reply.data.results);
    cursor = reply.data.nextCursor;
  } while (cursor !== undefined);
  return found;
}

/**
 * The requests behavior to show, chosen when the app opens: `capture`, as the
 * README names it, or else the first by name of those with people, which
 * every behavior in use has. With none yet, `capture`.
 */
export async function findRequestsBehavior(
  client: SwampClient,
): Promise<string> {
  const people = await queryAll(
    client,
    `modelType == "${REQUESTS_TYPE}" && specName == "person"`,
  );
  const names = [...new Set(people.map((r) => r.modelName))].sort();
  return names.includes("capture") ? "capture" : names[0] ?? "capture";
}

export async function openCapture(
  client: SwampClient,
): Promise<{ behavior: string; source: CaptureSource }> {
  const behavior = await findRequestsBehavior(client);
  const source = captureSource(
    (predicate) => queryAll(client, predicate),
    behavior,
  );
  await source.refresh();
  return { behavior, source };
}
