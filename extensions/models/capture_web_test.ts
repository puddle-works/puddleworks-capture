// The viewer behavior, served for real on 127.0.0.1.
import { describe, expect, it } from "./_lib/domain/test_bdd.ts";
import { agreedRequest } from "./_lib/domain/test_fixtures.ts";
import { toResource } from "./_lib/capture/swamp_store.ts";
import { serveViewer } from "./_lib/web/serve.ts";
import { VIEWER_ASSETS } from "./_lib/web/assets.ts";
import { model } from "./capture_web.ts";

describe("@puddleworks/capture/web", () => {
  it("declares its type and a serve method that defaults to a free port", () => {
    expect(model.type).toBe("@puddleworks/capture/web");
    expect(model.methods.serve.arguments.parse({})).toEqual({ port: 0 });
    expect(model.methods.serve.arguments.parse({ port: "3001" })).toEqual({
      port: 3001,
    });
    expect(model.globalArguments.parse({})).toEqual({ requests: "capture" });
  });

  it("upgrades existing instances to its version, keeping their settings", () => {
    const last = model.upgrades.at(-1)!;
    expect(last.toVersion).toBe(model.version);
    expect(last.upgradeAttributes({ requests: "capture" })).toEqual({
      requests: "capture",
    });
  });

  it("serves the page, rendered from swamp data, until the signal aborts", async () => {
    const abort = new AbortController();
    const listening = Promise.withResolvers<number>();
    const record = {
      name: "request-r-1",
      version: 1,
      attributes: toResource({
        request: agreedRequest(),
        version: 1,
        idempotencyKeys: [],
        before: null,
        legacy: null,
        number: 1,
      }),
    };
    const served = serveViewer(
      {
        queryData: (p: string) =>
          Promise.resolve(p.includes(`"request"`) ? [record] : []),
        logger: { info: () => {} },
        signal: abort.signal,
      },
      {
        port: 0,
        requests: "capture",
        onListen: (port) => listening.resolve(port),
      },
      VIEWER_ASSETS,
    );
    const port = await listening.promise;
    const page = await (await fetch(`http://127.0.0.1:${port}/requests/1`))
      .text();
    expect(page).toContain("<title>#1 Stock counts — Capture</title>");
    expect(page).toContain("We count stock every Friday.");
    const list = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(list).toContain('href="/requests/r-1"');
    const api = await fetch(`http://127.0.0.1:${port}/api/requests`);
    expect(api.status).toBe(404);
    await api.body?.cancel();
    abort.abort();
    expect(await served).toEqual({ dataHandles: [] });
  });
});
