// The Slack behavior's settings and serve, against a stand-in Slack on
// 127.0.0.1. The app itself is tested in _lib/slack/app_test.ts.
import { describe, expect, it } from "./_lib/domain/test_bdd.ts";
import { model } from "./capture_slack.ts";

const tokens = { channel: "C1", botToken: "xoxb-t", appToken: "xapp-t" };

/** A Slack with only Socket Mode: it opens a connection and says hello. */
function fakeSlack() {
  const auth: string[] = [];
  const server: Deno.HttpServer<Deno.NetAddr> = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    (req): Response => {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const { socket, response } = Deno.upgradeWebSocket(req);
        socket.onopen = () => socket.send(JSON.stringify({ type: "hello" }));
        return response;
      }
      auth.push(`${url.pathname} ${req.headers.get("authorization")}`);
      return Response.json({
        ok: true,
        url: `ws://127.0.0.1:${server.addr.port}/ws`,
      });
    },
  );
  return { server, auth, api: `http://127.0.0.1:${server.addr.port}/api` };
}

describe("@puddleworks/capture/slack", () => {
  it("declares its type at the version the manifest publishes", async () => {
    expect(model.type).toBe("@puddleworks/capture/slack");
    const manifest = await Deno.readTextFile(
      new URL("../../manifest.yaml", import.meta.url),
    );
    expect(model.version).toBe(
      manifest.match(/^version: "([^"]+)"$/m)?.[1],
    );
  });

  it("needs a channel and both tokens, and marks the tokens sensitive", () => {
    expect(model.globalArguments.safeParse({ channel: "C1" }).success).toBe(
      false,
    );
    expect(model.globalArguments.parse(tokens).agent).toBe("");
    const shape = model.globalArguments.shape;
    expect(shape.botToken.meta()?.sensitive).toBe(true);
    expect(shape.appToken.meta()?.sensitive).toBe(true);
  });

  it("refuses to serve without swamp's data query", async () => {
    const run = model.methods.serve.execute({} as never, {
      globalArgs: model.globalArguments.parse(tokens),
      repoDir: "/repo",
      writeResource: () => Promise.resolve({ name: "x" }),
      logger: { info: () => {} },
    });
    await expect.rejects(
      run,
      expect.objectContaining({
        message: expect.stringContaining("no data query"),
      }),
    );
  });

  it("connects in Socket Mode with the app token, and stops on the signal", async () => {
    const slack = fakeSlack();
    const abort = new AbortController();
    const connected = Promise.withResolvers<void>();
    const served = model.methods.serve.execute({} as never, {
      globalArgs: model.globalArguments.parse({
        ...tokens,
        slackApiUrl: slack.api,
      }),
      repoDir: "/repo",
      queryData: () => Promise.resolve([]),
      writeResource: () => Promise.resolve({ name: "x" }),
      logger: {
        info: (m: string) => {
          if (m === "Connected to Slack") connected.resolve();
        },
      },
      signal: abort.signal,
    });
    await connected.promise;
    abort.abort();
    expect(await served).toEqual({ dataHandles: [] });
    expect(slack.auth).toEqual(["/api/apps.connections.open Bearer xapp-t"]);
    await slack.server.shutdown();
  });
});
