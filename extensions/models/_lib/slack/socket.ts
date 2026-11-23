// Slack's Socket Mode: the app opens a WebSocket to Slack, so it needs no
// public URL. Each envelope is acknowledged at once, as Slack wants within
// three seconds, and handled after; the connection is opened again whenever
// Slack closes it or asks to refresh.
import type { SlackCall } from "./api.ts";

export interface Envelope {
  envelope_id?: string;
  type: string;
  payload?: Record<string, unknown>;
}

export async function runSocketMode(
  slack: SlackCall,
  handle: (envelope: Envelope) => Promise<void>,
  options: {
    signal?: AbortSignal;
    log: (message: string, props?: Record<string, unknown>) => void;
    /** Waits before opening again after a failure. */
    retryMs?: number;
  },
): Promise<void> {
  const { signal, log } = options;
  while (!signal?.aborted) {
    try {
      const { url } = await slack("apps.connections.open", {}) as {
        url: string;
      };
      await connection(url, handle, log, signal);
    } catch (e) {
      log("Slack connection failed: {error}", { error: String(e) });
    }
    if (signal?.aborted) break;
    await new Promise((r) => setTimeout(r, options.retryMs ?? 2_000));
  }
}

function connection(
  url: string,
  handle: (envelope: Envelope) => Promise<void>,
  log: (message: string, props?: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const stop = () => ws.close();
    signal?.addEventListener("abort", stop, { once: true });
    ws.onmessage = (event) => {
      let envelope: Envelope;
      try {
        envelope = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (envelope.type === "hello") {
        log("Connected to Slack");
        return;
      }
      if (envelope.type === "disconnect") {
        ws.close();
        return;
      }
      if (envelope.envelope_id) {
        ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
      }
      handle(envelope).catch((e) =>
        log("Handling a Slack {type} failed: {error}", {
          type: envelope.type,
          error: String(e),
        })
      );
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      signal?.removeEventListener("abort", stop);
      resolve();
    };
  });
}
