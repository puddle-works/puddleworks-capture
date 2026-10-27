/**
 * @puddleworks/capture/web — a read-only page showing Capture's requests
 *
 * `serve` shows every request of one `@puddleworks/capture/requests`
 * behavior on 127.0.0.1: the list grouped by state, and each request's
 * details, people, discussion, specification versions and history. It only
 * reads; every change goes through the requests behavior's methods. The page
 * reloads as the data changes.
 *
 * @module
 */
import { z } from "npm:zod@4.6.5";
import { VIEWER_ASSETS } from "./_lib/web/assets.ts";
import { serveViewer, type ViewerContext } from "./_lib/web/serve.ts";

/** The behavior's settings: which requests behavior to show. */
export const GlobalArgsSchema = z.object({
  requests: z.string().min(1).default("capture").describe(
    "The name of the @puddleworks/capture/requests behavior to show.",
  ),
});
/** The settings, as the serve method sees them. */
export type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

/** The behavior type: serves the read-only Capture page. */
export const model = {
  type: "@puddleworks/capture/web",
  version: "2026.10.27.5",
  globalArguments: GlobalArgsSchema,
  // Moves existing instances' typeVersion along; the settings are unchanged.
  upgrades: [
    {
      toVersion: "2026.10.27.2",
      description: "Request numbers; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.27.3",
      description: "Every change is logged; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.27.4",
      description: "No settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.27.5",
      description: "Shows reviewers; no settings changed",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  methods: {
    serve: {
      description:
        "Serve the Capture page on 127.0.0.1 until Ctrl-C: every request, read-only, reloaded as it changes",
      // Not a read method: it runs for the session, holding this instance's
      // lock, so it is its own type and never blocks the requests behavior.
      arguments: z.object({
        port: z.coerce.number().int().min(0).max(65535).default(0).describe(
          "The port on 127.0.0.1; 0, the default, picks a free one",
        ),
      }),
      execute: (
        args: { port: number },
        context: ViewerContext & { globalArgs: GlobalArgs },
      ) =>
        serveViewer(context, {
          port: args.port,
          requests: context.globalArgs.requests,
        }, VIEWER_ASSETS),
    },
  },
};
