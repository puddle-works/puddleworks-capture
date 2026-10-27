# ADR-003: Capture is a swamp extension with a read-only page

## Status: Accepted (2026-10-27)

The cut-over is done: the Node app's data was imported into swamp, and `apps/`
and `packages/` were deleted (2026-10-27).

Supersedes [ADR-002](ADR-002-capture-standalone.md). The domain, lifecycle and
`outcome-spec/v1` hand-off it chose stay as they are.

## Context

ADR-002 made Capture a Node product: a Hono API, a React web app, Better Auth
and Postgres, run by a LaunchAgent on this Mac. In use, the people raising and
agreeing requests are few and known, and most requests arrive from programs
(puddlerouter's `@puddleworks/capture-log-request` workflow, through the
separate `@puddleworks/capture-client` extension and an API key). Running a
server, a database, sign-in and key management for that is more than the job
needs.

Stagecraft showed a lighter shape: a swamp extension that keeps its state in
swamp data and serves a small Preact page, built into the extension, that only
reads it.

## Decision

Capture becomes the swamp extension `@puddleworks/capture` (private, in the
puddleworks collective) with two behavior types and one workflow:

- **`@puddleworks/capture/requests`** holds the people list and the requests in
  swamp data, one `request-<id>` resource per request, a new version per change.
  Every change is a method (`create_request`, `submit`, `propose`, `agree`,
  `export_outcome_spec`, …). The rules are ADR-002's, copied from
  `packages/domain` into `extensions/models/_lib/domain`.
- **Who acts:** each method takes `as: <email>`, defaulting to the behavior's
  `defaultAs`. The person must be in the people list (`add_person`,
  `update_person`), and their role on the request (outcome owner, builder,
  observer) decides what they may do. There are no passwords, sessions or API
  keys: whoever can run swamp in the repository is trusted to say who they are.
- **`@puddleworks/capture/web`** serves a read-only Preact page on 127.0.0.1:
  the requests by state, and each request's details, people, discussion,
  specification versions, history and Puddleworks history. It answers GET only
  and reloads as data changes. `web/build.ts` bundles it into
  `extensions/models/_lib/web/assets.ts`; a test fails when the bundle is older
  than its source.
- **The client folds in.** `create_request` takes an idempotency key, so a retry
  hands back the request it made. The `@puddleworks/capture-log-request`
  workflow moves here with the same inputs and calls `capture.create_request`.
  The `puddleworks-capture-client` repository is retired.
- **Cut-over in two steps.** First the extension ships next to the Node app,
  with `pnpm --filter @capture/api export:snapshot` to copy people and requests
  out of Postgres and the `import` method to bring them in; the Node app keeps
  running. After the switch, a second change deletes `apps/` and `packages/`.

## Consequences

**Good:**

- No server, database, sign-in or keys to run; swamp data is the record, with
  every version kept
- Programs log requests through a workflow in the same repository, not over HTTP
  with a key
- One toolchain (Deno) once `apps/` and `packages/` are gone

**Trade-offs:**

- `as` is a claim, not a proof. That is fine for a handful of known people
  running swamp themselves, and wrong for anyone else; opening Capture wider
  would need swamp serve with grants, or ADR-002's sign-in back
- The page only reads. Discussing and writing a specification happen through
  `swamp behavior run`, which suits builders more than outcome owners
- The domain is copied, not shared, until `packages/` is deleted; a change made
  to one copy in the meantime must be made to both
- The iPhone app ADR-002 planned for has no API to use
