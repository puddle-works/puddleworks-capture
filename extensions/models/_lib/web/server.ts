// The viewer's HTTP handler. It only reads: the page, rendered as HTML from
// swamp data, its files, and an event stream that says when to read the page
// again and carries nothing else. No route answers with request data as
// JSON: a script or agent reads requests through the requests behavior's
// methods and swamp data, whose rules decide what it may see.
//
// The page is served on each view's path, so a request has an address a
// person can reload, bookmark or follow from an exported outcome spec:
// / for the list and /requests/<id> for one request.
//
// A request is refused before routing when:
// - its Host is not 127.0.0.1:<port> or localhost:<port> (DNS rebinding);
// - it carries an Origin other than the server's own;
// - it carries a Sec-Fetch-Site other than same-origin or none, which is how
//   a hostile page's no-cors load (script, img, link) shows itself, unless it
//   is a person opening a page from a link;
// - its method is not GET.
// No response carries a CORS header. Every response carries a strict CSP and
// Cross-Origin-Resource-Policy: same-origin.
import type {
  WebEvent,
  WebOverview,
  WebRequest,
} from "../capture/view_types.ts";
import { renderPage } from "./page/layout.tsx";

/** One file of the page, as build.ts embeds it. */
export interface ViewerAsset {
  type: string;
  text?: string;
  base64?: string;
}

export interface ViewerEvents {
  subscribe(listener: (event: WebEvent) => void): () => void;
}

export interface ViewerDeps {
  /** The port the server is bound to, for the Host check. */
  port: number;
  assets: Readonly<Record<string, ViewerAsset>>;
  overview(): WebOverview;
  request(id: string): WebRequest | undefined;
  events: ViewerEvents;
  /** Aborts on shutdown; open event streams close with it. */
  signal?: AbortSignal;
  /** Seconds between keepalive comments on an event stream. */
  keepaliveSeconds?: number;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy":
    "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

function respond(
  body: BodyInit | null,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, ...headers },
  });
}

function error(status: number, message: string): Response {
  return respond(message, status, {
    "content-type": "text/plain; charset=utf-8",
  });
}

/** The path's parts, or null for one that doesn't decode. */
function segments(pathname: string): string[] | null {
  try {
    return pathname.split("/").filter((p) => p !== "").map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** Whether a path is one the page is served on: / or /requests/<id>. */
export function isPagePath(parts: string[]): boolean {
  return parts.length === 0 ||
    (parts.length === 2 && parts[0] === "requests" && parts[1] !== "");
}

/**
 * Opening the page from a link in another site or app: a top-level GET of a
 * page path that the browser shows the person. The linking page cannot read
 * it, and frame-ancestors 'none' keeps it out of frames, so it is let
 * through; nothing else from another site is.
 */
function pageNavigation(req: Request): boolean {
  const parts = segments(new URL(req.url).pathname);
  return req.method === "GET" && parts !== null && isPagePath(parts) &&
    req.headers.get("sec-fetch-mode") === "navigate" &&
    req.headers.get("sec-fetch-dest") === "document";
}

/** Why a request is refused before routing, or null. */
function refusal(req: Request, port: number): Response | null {
  const host = req.headers.get("host");
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  // A browser leaves the default port out of Host and Origin.
  if (port === 80) hosts.push("127.0.0.1", "localhost");
  if (host === null || !hosts.includes(host)) {
    return error(403, "the Host header must name this server");
  }
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== `http://${host}`) {
    return error(403, "requests from another origin are refused");
  }
  const site = req.headers.get("sec-fetch-site");
  if (
    site !== null && site !== "same-origin" && site !== "none" &&
    !pageNavigation(req)
  ) {
    return error(403, "requests from another site are refused");
  }
  if (req.method !== "GET") {
    const res = error(405, "the viewer only reads; every route is GET");
    res.headers.set("allow", "GET");
    return res;
  }
  return null;
}

function asset(deps: ViewerDeps, name: string): Response {
  const found = Object.hasOwn(deps.assets, name) ? deps.assets[name] : null;
  if (found === null) return error(404, `no such page file: ${name}`);
  const body = found.base64 !== undefined
    ? Uint8Array.from(atob(found.base64), (c) => c.charCodeAt(0))
    : found.text ?? "";
  return respond(body, 200, { "content-type": found.type });
}

function page(deps: ViewerDeps, parts: string[]): Response {
  const shell = deps.assets["index.html"]?.text ?? "";
  const { status, html } = renderPage(
    shell,
    parts.length === 0
      ? { page: "list", overview: deps.overview() }
      : { page: "request", request: deps.request(parts[1]) },
  );
  return respond(html, status, { "content-type": "text/html; charset=utf-8" });
}

function eventStream(deps: ViewerDeps): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      // Only the event's type: the page reads itself again to see what.
      const unsubscribe = deps.events.subscribe((event) =>
        send(`data: ${event.type}\n\n`)
      );
      const keepalive = setInterval(
        () => send(": keepalive\n\n"),
        (deps.keepaliveSeconds ?? 15) * 1000,
      );
      const close = () => {
        if (!open) return;
        cleanup();
        controller.close();
      };
      cleanup = () => {
        open = false;
        unsubscribe();
        clearInterval(keepalive);
        deps.signal?.removeEventListener("abort", close);
      };
      deps.signal?.addEventListener("abort", close);
      send(": connected\n\n");
      // Opened as the server began to stop.
      if (deps.signal?.aborted) close();
    },
    // The page went away.
    cancel() {
      cleanup();
    },
  });
  return respond(body, 200, {
    "content-type": "text/event-stream; charset=utf-8",
  });
}

export function handleViewerRequest(
  req: Request,
  deps: ViewerDeps,
): Response | Promise<Response> {
  const refused = refusal(req, deps.port);
  if (refused) return refused;
  const parts = segments(new URL(req.url).pathname);
  if (parts === null) return error(400, "the path doesn't decode");
  if (isPagePath(parts)) return page(deps, parts);
  if (parts.length === 1 && parts[0] === "events") return eventStream(deps);
  if (parts.length === 1 && parts[0] !== "index.html") {
    return asset(deps, parts[0]);
  }
  return error(404, "no such page");
}
