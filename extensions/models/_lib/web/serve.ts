// Runs the viewer: reads Capture's data, serves it on 127.0.0.1 and polls for
// changes until swamp's signal aborts (Ctrl-C).
import type { WebEvent } from "../capture/view_types.ts";
import {
  handleViewerRequest,
  type ViewerAsset,
  type ViewerDeps,
} from "./server.ts";
import { captureSource, type QueryData } from "./source.ts";

/** How often serve reads Capture's data again. */
const POLL_SECONDS = 3;

/** The part of swamp's method context serve uses. */
export interface ViewerContext {
  queryData?: QueryData;
  logger: { info: (message: string, props?: Record<string, unknown>) => void };
  signal?: AbortSignal;
}

export async function serveViewer(
  ctx: ViewerContext,
  options: {
    port: number;
    requests: string;
    pollSeconds?: number;
    onListen?: (port: number) => void;
  },
  assets: Readonly<Record<string, ViewerAsset>>,
): Promise<{ dataHandles: { name: string }[] }> {
  if (typeof ctx.queryData !== "function") {
    throw new Error(
      "this swamp gives no data query, which the viewer reads Capture's data with",
    );
  }
  const source = captureSource(ctx.queryData.bind(ctx), options.requests);
  await source.refresh();
  const listeners = new Set<(event: WebEvent) => void>();
  // One poll at a time: a slow datastore skips a beat rather than piling up.
  let polling = false;
  const poll = setInterval(() => {
    if (polling) return;
    polling = true;
    source
      .refresh()
      .then((changed) => {
        if (changed) {
          listeners.forEach((listener) => listener({ type: "changed" }));
        }
      })
      .catch(() => {
        // Data mid-write; the next poll sees it whole.
      })
      .finally(() => (polling = false));
  }, (options.pollSeconds ?? POLL_SECONDS) * 1000);
  try {
    const deps: ViewerDeps = {
      // Set once the server has bound, before any request can arrive.
      port: 0,
      assets,
      overview: () => source.overview(),
      request: (id) => source.request(id),
      events: {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      // Deno.serve waits for open responses when it stops, so the event
      // streams close on the same signal.
      signal: ctx.signal,
    };
    const server = Deno.serve({
      hostname: "127.0.0.1",
      port: options.port,
      signal: ctx.signal,
      onListen: ({ port }) => {
        ctx.logger.info("Capture viewer: http://127.0.0.1:{port}/", { port });
        options.onListen?.(port);
      },
    }, (req) => handleViewerRequest(req, deps));
    deps.port = server.addr.port;
    await server.finished;
  } finally {
    // Also when the port cannot be bound.
    clearInterval(poll);
  }
  return { dataHandles: [] };
}
