/**
 * @puddleworks/capture/slack — Capture's request discussions in Slack
 *
 * `serve` connects to Slack in Socket Mode, so it needs no public URL, and
 * runs until stopped. Each request gets one thread in `channel`: /capture
 * raises one, replies in its thread are posted on it, and Agreed, Building,
 * Released and a failed router test are posted back. Buttons are shown only
 * to the person they are for, and only for steps Capture would let them
 * take. Each Slack user is matched by email to Capture's people list and
 * every step runs a Capture method with them as `as`; anyone not on the
 * list is refused. When one person is both requester and builder, the
 * stand-in agent for the role they aren't playing takes its turn through
 * the @puddleworks/capture-stand-in workflow.
 *
 * Tokens come from a swamp vault: botToken and appToken are vault
 * expressions in the behavior's definition, never the tokens themselves.
 *
 * Output:
 * - `thread`: where a request's Slack thread is and what it has shown (`thread-<requestId>`).
 *
 * @module
 */
import { z } from "npm:zod@4.6.7";
import { type DiscussionPoint, type Person } from "./_lib/domain/index.ts";
import type { Stored } from "./_lib/capture/ports.ts";
import {
  fromResource,
  recordObject,
  toPerson,
} from "./_lib/capture/swamp_store.ts";
import { predicate, type QueryData } from "./_lib/web/source.ts";
import { slackApi } from "./_lib/slack/api.ts";
import {
  CaptureRefusal,
  type CaptureRun,
  createApp,
  type ThreadRecord,
} from "./_lib/slack/app.ts";
import { runSocketMode } from "./_lib/slack/socket.ts";

/** The behavior's settings. */
export const GlobalArgsSchema = z.object({
  requests: z.string().min(1).default("capture").describe(
    "The name of the @puddleworks/capture/requests behavior.",
  ),
  channel: z.string().min(1).describe(
    "The Slack channel id (such as C0123ABCD) where requests are discussed. Invite the app to it.",
  ),
  botToken: z.string().min(1).meta({ sensitive: true }).describe(
    "The bot token (xoxb-…), from a vault: never the token itself. See the README.",
  ),
  appToken: z.string().min(1).meta({ sensitive: true }).describe(
    "The app-level token with connections:write (xapp-…), from a vault: never the token itself.",
  ),
  agent: z.string().default("").describe(
    "The agent behavior stand-ins answer with, such as a @mgreten/cli-agent behavior. Blank: no stand-ins.",
  ),
  builderAgentAs: z.string().default("").describe(
    "The builder agent's email in the people list (add_person standIn=builder).",
  ),
  requesterAgentAs: z.string().default("").describe(
    "The requester agent's email in the people list (add_person standIn=requester).",
  ),
  pollSeconds: z.coerce.number().int().min(2).max(600).default(10).describe(
    "How often Capture is read again, to post changes made outside Slack.",
  ),
  slackApiUrl: z.url().default("https://slack.com/api").describe(
    "Slack's Web API. Change it only to test against a stand-in Slack.",
  ),
  swampPath: z.string().default("swamp").describe(
    "The swamp command, to run Capture's methods.",
  ),
});
export type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

const ThreadSchema = z.object({
  requestId: z.string(),
  channel: z.string(),
  ts: z.string(),
  status: z.string(),
  routerTests: z.number().int(),
  shownMessages: z.number().int(),
  shownTransitions: z.number().int().optional(),
});

interface SlackContext {
  globalArgs: GlobalArgs;
  repoDir: string;
  queryData?: QueryData;
  writeResource(
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ): Promise<{ name: string }>;
  logger: { info: (message: string, props?: Record<string, unknown>) => void };
  signal?: AbortSignal;
}

/** Runs `swamp <args>` in the repository; its JSON output, or its error. */
async function swampJson(
  ctx: SlackContext,
  args: string[],
): Promise<{ ok: boolean; out: Record<string, unknown> }> {
  // Each Capture step is its own swamp run, so Capture's rules and lock apply
  // as they do from the command line. The arguments are a fixed method name
  // and one JSON input read as data (--literal-inputs), with no shell.
  // swamp-quality-ignore deno-command
  const output = await new Deno.Command(ctx.globalArgs.swampPath, {
    args: [...args, "--json"],
    cwd: ctx.repoDir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(output.stdout).trim();
  let out: Record<string, unknown> = {};
  try {
    out = JSON.parse(text.slice(text.indexOf("{")));
  } catch {
    out = { error: new TextDecoder().decode(output.stderr).slice(-500) };
  }
  return { ok: output.code === 0, out };
}

/** Capture's method, run as its own swamp run, so Capture's rules and lock apply. */
export function captureRunner(ctx: SlackContext): CaptureRun {
  return async (method, input) => {
    const { ok, out } = await swampJson(ctx, [
      "behavior",
      "run",
      ctx.globalArgs.requests,
      method,
      "--input",
      JSON.stringify(input),
      "--literal-inputs",
    ]);
    if (!ok) {
      // Capture's refusals end with their code, such as "(not_allowed)".
      const said = String(out.error ?? "Capture refused that.");
      throw new CaptureRefusal(said.replace(/ \((\w+)\)$/, ""));
    }
  };
}

/** The behavior type: Capture in Slack. */
export const model = {
  type: "@puddleworks/capture/slack",
  version: "2026.11.27.2",
  globalArguments: GlobalArgsSchema,
  upgrades: [
    {
      toVersion: "2026.11.24.2",
      description:
        "zod 4.6.7, past advisory GHSA-mrhx-c7xc-m3w5; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.25.1",
      description:
        "Released with the app's steps and recent changes; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.27.1",
      description:
        "Record build's check is shared with the Capture app; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.27.2",
      description:
        "Released with stand-in turns in the Capture app; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  resources: {
    thread: {
      description:
        "Where a request's Slack thread is, and how much of the request it has shown.",
      schema: ThreadSchema,
      lifetime: "infinite" as const,
      garbageCollection: 5,
    },
  },
  methods: {
    serve: {
      description:
        "Run Capture's Slack app until stopped: Socket Mode, so no public URL is needed.",
      arguments: z.object({}),
      execute: async (_args: Record<string, never>, ctx: SlackContext) => {
        if (typeof ctx.queryData !== "function") {
          throw new Error(
            "this swamp gives no data query, which the Slack app reads Capture with",
          );
        }
        const query = ctx.queryData.bind(ctx);
        const g = ctx.globalArgs;
        const read = {
          async requests(): Promise<Stored[]> {
            return (await query(predicate(g.requests, "request")))
              .map((r) => recordObject(r as never))
              .filter((d): d is Record<string, unknown> =>
                d !== null && typeof d.id === "string"
              )
              .map(fromResource);
          },
          async people(): Promise<Person[]> {
            return (await query(predicate(g.requests, "person")))
              .map((r) => recordObject(r as never))
              .filter((d): d is Record<string, unknown> =>
                d !== null && typeof d.userId === "string"
              )
              .map(toPerson);
          },
        };
        const saved = new Map<string, ThreadRecord>();
        for (
          const record of await query(
            `modelType == "${model.type}" && specName == "thread"`,
          )
        ) {
          const data = ThreadSchema.safeParse(recordObject(record as never));
          if (data.success) saved.set(data.data.requestId, data.data);
        }
        const threads = {
          all: () => [...saved.values()],
          async save(thread: ThreadRecord) {
            saved.set(thread.requestId, thread);
            await ctx.writeResource("thread", `thread-${thread.requestId}`, {
              ...thread,
            });
          },
        };
        const slack = slackApi(
          { bot: g.botToken, app: g.appToken },
          g.slackApiUrl,
        );
        const log = (m: string, p?: Record<string, unknown>) =>
          ctx.logger.info(m, p);
        const agents = g.agent
          ? {
            builderAs: g.builderAgentAs || undefined,
            requesterAs: g.requesterAgentAs || undefined,
          }
          : undefined;
        const app = createApp({
          slack,
          capture: captureRunner(ctx),
          read,
          threads,
          log,
          runStandIn: async (
            requestId: string,
            standInAs: string,
            point: DiscussionPoint | undefined,
          ) => {
            const { ok, out } = await swampJson(ctx, [
              "workflow",
              "run",
              "@puddleworks/capture-stand-in",
              "--input",
              JSON.stringify({
                id: requestId,
                agent: g.agent,
                standInAs,
                point: point ?? "",
              }),
            ]);
            if (!ok) {
              throw new Error(String(out.error ?? "the workflow failed"));
            }
          },
        }, { channel: g.channel, agents });
        const poll = setInterval(
          () =>
            app.poll().catch((e) => log("Poll failed: {e}", { e: String(e) })),
          g.pollSeconds * 1000,
        );
        try {
          await app.poll();
          await runSocketMode(slack, app.handle, { signal: ctx.signal, log });
        } finally {
          clearInterval(poll);
        }
        return { dataHandles: [] };
      },
    },
  },
};
