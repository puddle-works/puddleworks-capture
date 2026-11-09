// The viewer's HTTP handler: read-only, local only, and strict about who may
// call it.
import { describe, expect, it } from "../domain/test_bdd.ts";
import { agreedRequest, builder } from "../domain/test_fixtures.ts";
import { startBuilding } from "../domain/index.ts";
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
        text:
          '<!doctype html><title>Capture</title><div id="root"></div><script src="/app.js"></script>',
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
  it("renders the list on / and each request on its own address, as HTML", async () => {
    const list = await handleViewerRequest(get("/"), deps());
    expect(list.status).toBe(200);
    expect(list.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(list.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    const listHtml = await list.text();
    expect(listHtml).toContain("<title>Requests — Capture</title>");
    expect(listHtml).toContain('<a href="/requests/r-1">#1 Stock counts</a>');
    const one = await (await handleViewerRequest(get("/requests/r-1"), deps()))
      .text();
    expect(one).toContain("<title>#1 Stock counts — Capture</title>");
    expect(one).toContain("We count stock every Friday.");
    expect(one).toContain('<script src="/app.js"></script>');
  });

  it("shows the Build section once building has started, with no result yet", async () => {
    const page = async (request: typeof stored.request) =>
      await (await handleViewerRequest(
        get("/requests/r-1"),
        deps({ request: () => toWebRequest({ ...stored, request }) }),
      )).text();
    expect(await page(agreedRequest())).not.toContain("build-heading");
    expect(
      await page(
        startBuilding(agreedRequest(), builder, "2026-10-23T13:00:00.000Z"),
      ),
    ).toContain("Work has started. No build result has been recorded yet.");
  });

  it("answers a request there is no record of with a page saying so", async () => {
    const res = await handleViewerRequest(get("/requests/nope"), deps());
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("There is no such request.");
  });

  it("escapes what people wrote", async () => {
    const res = await handleViewerRequest(
      get("/requests/r-1"),
      deps({
        request: () => ({
          ...toWebRequest(stored),
          title: "<script>alert(1)</script>",
        }),
      }),
    );
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(
      "<title>#1 &lt;script&gt;alert(1)&lt;/script&gt; — Capture</title>",
    );
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

  it("serves no request data as JSON: the old API routes are gone", async () => {
    for (
      const path of [
        "/api/requests",
        "/api/requests/r-1",
        "/api/requests/1",
        "/api/events",
        "/index.html",
      ]
    ) {
      const res = await handleViewerRequest(
        get(path, { accept: "application/json" }),
        deps(),
      );
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).not.toContain("json");
      expect(await res.text()).not.toContain("Stock counts");
    }
  });

  it("only reads", async () => {
    const res = await handleViewerRequest(
      get("/", {}, "POST"),
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
        get("/", { origin: "http://evil.example" }),
        deps(),
      )).status,
    )
      .toBe(403);
    expect(
      (await handleViewerRequest(
        get("/events", { "sec-fetch-site": "cross-site" }),
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
      (await handleViewerRequest(get("/events", link), deps())).status,
    ).toBe(403);
  });

  it("streams that something changed, and nothing about what", async () => {
    let send: (e: { type: "changed" }) => void = () => {};
    const abort = new AbortController();
    const res = await handleViewerRequest(
      get("/events"),
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
      `data: changed\n\n`,
    );
    abort.abort();
    expect((await reader.read()).done).toBe(true);
  });
});
