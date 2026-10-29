import { z } from "npm:zod@4.6.5";

/**
 * puddleworks.dev/build-result/v1: what a build produced, and where it is.
 * The Factory owns the contract; this is Capture's reader of it, with the
 * Factory's rules for each field. Fields Capture doesn't know are dropped, as
 * the contract lets a reader do. `examples` is an optional addition, so a
 * result without it still reads.
 */
export const BUILD_RESULT_V1 = "puddleworks.dev/build-result/v1";

// The page links to these, so only https is taken.
const httpsUrl = z.url({ protocol: /^https$/ });

const repoPath = z.string().min(1).refine(
  (p) => !p.startsWith("/") && !p.split("/").includes(".."),
  "must be relative to the repository root and stay inside it",
);

const packageName = z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/);

export const BuildResultV1Schema = z.object({
  apiVersion: z.literal(BUILD_RESULT_V1),
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
  /** How the built recipe answered each example phrase it was run with. */
  examples: z.array(z.object({
    phrase: z.string().trim().min(1).max(500),
    passed: z.boolean(),
    detail: z.string().max(2_000).optional(),
  })).max(50).optional(),
  builtAt: z.iso.datetime(),
});
export type BuildResultV1 = z.infer<typeof BuildResultV1Schema>;

/** Reads a build result from parsed JSON. Problems are in plain words. */
export function parseBuildResult(
  value: unknown,
): { ok: true; result: BuildResultV1 } | { ok: false; problems: string[] } {
  const parsed = BuildResultV1Schema.safeParse(value);
  if (parsed.success) return { ok: true, result: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map((issue) => {
      const where = issue.path.join(".") || "(top level)";
      return where === "apiVersion"
        ? `apiVersion must be "${BUILD_RESULT_V1}".`
        : `${where}: ${issue.message}`;
    }),
  };
}
