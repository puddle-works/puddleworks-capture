// The viewer's HTTP handler: read-only, local only, and strict about who may
// call it.
import { describe, expect, it } from "../domain/test_bdd.ts";
import { agreedRequest } from "../domain/test_fixtures.ts";
import { toWebRequest, toWebSummary } from "../capture/views.ts";
import { handleViewerRequest, type ViewerDeps } from "./server.ts";

const stored = {
  request: agreedRequest(),
  version: 3,
  idempotencyKeys: [],
  before: null,
  legacy: null,
  number: 1,
};
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;

function deps(extra: Partial<ViewerDeps> = {}): ViewerDeps {
  return {
    port: PORT,
    assets: {
      "index.html": {
        type: "text/html; charset=utf-8",
        text: "<!doctype html><title>Capture</title>",
      },
      "app.js": {
        type: "text/javascript; charset=utf-8",
        text: "console.log(1)",
      },
      "logo.png": { type: "image/png", base64: btoa("png") },
    },
    overview: () => ({
      requests: [toWebSummary(stored)],
      people: [],
      readAt: "2026-10-27T09:00:00.000Z",
    }),
    request: (id) => (id === "r-1" ? toWebRequest(stored) : undefined),
    events: { subscribe: () => () => {} },
    ...extra,
  };
}

function get(
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { host: `127.0.0.1:${PORT}`, ...headers },
  });
}

describe("viewer server", () => {
  it("serves the page on / and on each request's own address", async () => {
    for (const path of ["/", "/requests/r-1"]) {
      const res = await handleViewerRequest(get(path), deps());
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("content-security-policy")).toContain(
        "default-src 'self'",
      );
      expect(await res.text()).toContain("<title>Capture</title>");
    }
  });

  it("serves the page's files, text and binary", async () => {
    const js = await handleViewerRequest(get("/app.js"), deps());
    expect(await js.text()).toBe("console.log(1)");
    const png = await handleViewerRequest(get("/logo.png"), deps());
    expect(new TextDecoder().decode(await png.arrayBuffer())).toBe("png");
    expect((await handleViewerRequest(get("/missing.js"), deps())).status).toBe(
      404,
    );
  });

  it("answers the list and one request as JSON", async () => {
    const list = await (await handleViewerRequest(get("/api/requests"), deps()))
      .json();
    expect(list.requests[0]).toMatchObject({ id: "r-1", status: "agreed" });
    const one = await handleViewerRequest(get("/api/requests/r-1"), deps());
    expect(await one.json()).toMatchObject({
      id: "r-1",
      specifications: [{ version: 1 }],
    });
    expect(
      (await handleViewerRequest(get("/api/requests/nope"), deps())).status,
    ).toBe(404);
  });

  it("only reads", async () => {
    const res = await handleViewerRequest(
      get("/api/requests", {}, "POST"),
      deps(),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("refuses another Host, another Origin and another site", async () => {
    expect(
      (await handleViewerRequest(get("/", { host: "evil.example" }), deps()))
        .status,
    ).toBe(403);
    expect(
      (await handleViewerRequest(
        get("/api/requests", { origin: "http://evil.example" }),
        deps(),
      )).status,
    )
      .toBe(403);
    expect(
      (await handleViewerRequest(
        get("/api/requests", { "sec-fetch-site": "cross-site" }),
        deps(),
      )).status,
    )
      .toBe(403);
    expect(
      (await handleViewerRequest(
        get("/", { host: `localhost:${PORT}` }),
        deps(),
      )).status,
    ).toBe(200);
  });

  it("lets a person open a request from a link elsewhere, but nothing else from another site", async () => {
    const link = {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    };
    expect(
      (await handleViewerRequest(get("/requests/r-1", link), deps())).status,
    ).toBe(200);
    expect(
      (await handleViewerRequest(get("/api/requests", link), deps())).status,
    ).toBe(403);
  });

  it("streams a change event to the page", async () => {
    let send: (e: { type: "changed" }) => void = () => {};
    const abort = new AbortController();
    const res = await handleViewerRequest(
      get("/api/events"),
      deps({
        signal: abort.signal,
        events: {
          subscribe: (listener) => {
            send = listener;
            return () => {};
          },
        },
      }),
    );
    expect(res.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain(
      ": connected",
    );
    send({ type: "changed" });
    expect(decoder.decode((await reader.read()).value)).toBe(
      `data: {"type":"changed"}\n\n`,
    );
    abort.abort();
    expect((await reader.read()).done).toBe(true);
  });
});
