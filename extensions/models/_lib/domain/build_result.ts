import { z } from "npm:zod@4.6.5";

/**
 * puddleworks.dev/build-result/v1 and /v2: what a build produced, and where
 * it is. The Factory owns the contract; this is Capture's reader of it, with
 * the Factory's rules for each field. Fields Capture doesn't know are
 * dropped, as the contract lets a reader do.
 *
 * v2 carries the recipe as published, so Capture can check its phrases and
 * its answer when there is nothing to show. It has no puddlerouter evidence:
 * the outcome owner sends the phrases through puddlerouter and records that
 * in Capture (record_router_test). v1 is still read, with each example's
 * `recipeId` and `router` as the builder reported them; it can't release a
 * request, as it carries no recipe.
 */
export const BUILD_RESULT_V1 = "puddleworks.dev/build-result/v1";
export const BUILD_RESULT_V2 = "puddleworks.dev/build-result/v2";

/** How puddlerouter answered a phrase: straight away, or after a yes. */
export const ROUTER_OUTCOMES = ["answered", "answered-after-yes"] as const;

// The page links to these, so only https is taken.
const httpsUrl = z.url({ protocol: /^https$/ });

const repoPath = z.string().min(1).refine(
  (p) => !p.startsWith("/") && !p.split("/").includes(".."),
  "must be relative to the repository root and stay inside it",
);

const packageName = z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/);

const example = z.object({
  phrase: z.string().trim().min(1).max(500),
  passed: z.boolean(),
  detail: z.string().max(2_000).optional(),
});

const common = {
  kind: z.literal("BuildResult"),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  extension: packageName,
  entryPointRef: packageName,
  repository: httpsUrl,
  path: repoPath.optional(),
  buildRef: z.string().min(1).max(500),
  pullRequest: httpsUrl.optional(),
  /** The outcome spec's request url, version and hash, copied as they were. */
  source: z.object({
    url: z.url({ protocol: /^https?$/ }),
    version: z.number().int().positive().optional(),
    specHash: z.string().min(1).optional(),
  }).optional(),
  published: z.object({
    version: z.string().min(1).max(100),
    visibility: z.enum(["public", "private"]),
  }).optional(),
  builtAt: z.iso.datetime(),
};

export const BuildResultV1Schema = z.object({
  apiVersion: z.literal(BUILD_RESULT_V1),
  ...common,
  /** How the built recipe answered each example phrase it was run with. */
  examples: z.array(example.extend({
    /** The id of the puddlerouter recipe that answered the phrase. */
    recipeId: z.string().min(1).max(200).optional(),
    /** The phrase sent through puddlerouter in the desk, and what came back. */
    router: z.object({
      testedAt: z.iso.datetime(),
      /** The extension's version installed when the phrase went through. */
      version: z.string().min(1).max(100),
      /** answered-after-yes: a write recipe asked for a yes, then ran. */
      outcome: z.enum(ROUTER_OUTCOMES),
      /** The request the recipe says it answers, as the router's match gave it. */
      source: z.object({
        url: z.url({ protocol: /^https?$/ }),
        version: z.number().int().positive().optional(),
      }).optional(),
    }).optional(),
  })).max(50).optional(),
});
export type BuildResultV1 = z.infer<typeof BuildResultV1Schema>;

export const BuildResultV2Schema = z.object({
  apiVersion: z.literal(BUILD_RESULT_V2),
  ...common,
  /** How the builder's own check of each example phrase came out. */
  examples: z.array(example).max(50).optional(),
  /**
   * The puddlerouter recipe as published, copied from its tag. Absent before
   * anything is published.
   */
  recipe: z.object({
    id: z.string().min(1).max(200),
    /** Compared with the agreed phrases as written, which are trimmed too. */
    phrases: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
    /** What it answers when there is nothing to show. */
    empty: z.string().trim().min(1).max(2_000),
  }).optional(),
});
export type BuildResultV2 = z.infer<typeof BuildResultV2Schema>;

export type BuildResult = BuildResultV1 | BuildResultV2;

const BuildResultSchema = z.discriminatedUnion("apiVersion", [
  BuildResultV1Schema,
  BuildResultV2Schema,
]);

/** Reads a build result from parsed JSON. Problems are in plain words. */
export function parseBuildResult(
  value: unknown,
): { ok: true; result: BuildResult } | { ok: false; problems: string[] } {
  const parsed = BuildResultSchema.safeParse(value);
  if (parsed.success) return { ok: true, result: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map((issue) => {
      const where = issue.path.join(".") || "(top level)";
      return where === "apiVersion" || where === "(top level)" &&
          issue.code === "invalid_union"
        ? `apiVersion must be "${BUILD_RESULT_V1}" or "${BUILD_RESULT_V2}".`
        : `${where}: ${issue.message}`;
    }),
  };
}
