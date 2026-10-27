// What the page reads from the viewer: the list, one request, and the event
// stream that says when to read them again.
import type {
  WebOverview,
  WebRequest,
} from "../../extensions/models/_lib/capture/view_types.ts";

/** A request the viewer has no record of. */
export class NotFound extends Error {}

async function read<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null) as { error?: string } | null;
  if (res.status === 404) throw new NotFound(body?.error ?? "Not found");
  if (!res.ok) {
    throw new Error(body?.error ?? `The viewer answered ${res.status}.`);
  }
  return body as T;
}

export const overview = () => read<WebOverview>("/api/requests");

export const request = (id: string) =>
  read<WebRequest>(`/api/requests/${encodeURIComponent(id)}`);

/** Calls `onChange` each time the data changes; returns a function that stops listening. */
export function watch(onChange: () => void): () => void {
  const events = new EventSource("/api/events");
  events.addEventListener("message", onChange);
  return () => events.close();
}
