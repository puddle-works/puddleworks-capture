# ADR-002: Capture is a standalone product

## Status: Superseded by [ADR-003](ADR-003-capture-swamp-extension.md) (2026-10-27)

Accepted 2026-10-22.

Supersedes the Capture parts of [ADR-001](ADR-001-three-separate-apps.md).
Factory and Distribution are unaffected.

## Context

ADR-001 made Capture its own swamp application. It still needs swamp to run: the
request lifecycle lives in a swamp model (`extensions/models/request.ts`), data
lives in swamp's store, identity comes from swamp serve tokens, and the only web
front end (`puddleworks-ui`, Rails) is a copy of swamp's data kept up to date by
a report.

Capture's job is narrower than the lifecycle it carries. It helps an outcome
owner and a builder agree what success looks like, then hands that agreement to
whatever builds it. Triage, delivery, publication and value measurement belong
to other processes.

A native iPhone app is planned, so the product needs an API both a web app and a
phone can use the same way.

## Decision

Capture becomes an independent product with no dependency on swamp, Factory or
Distribution:

- **Stack:** TypeScript on Node 24 LTS, pnpm workspaces. A Hono HTTP API
  (`/api/v1`, OpenAPI from zod schemas) and a Vite + React web app, served by
  one process from one container. PostgreSQL through Drizzle.
- **Domain:** Request, Participant, Message, Outcome Specification (versioned),
  Agreement, Export. Lifecycle: Draft → Discussing → Ready for agreement →
  Agreed → Exported, plus Withdrawn and Declined. (Later, agreeing became the
  hand-off and Exported was dropped: an agreed request has its outcome spec.)
  The rules live in `packages/domain`, pure TypeScript with no I/O, so a future
  Expo app can use the same schemas.
- **Hand-off:** one neutral format, `puddleworks.dev/outcome-spec/v1` (JSON and
  Markdown), that any process can pick up. Capture no longer writes
  `app-spec/v1`; Factory moves to the new format separately.
- **Auth:** Better Auth. Cookie sessions for the web app, OAuth authorisation
  code + PKCE with bearer tokens for the phone later. Permissions are checked on
  the server, per request, by role (outcome owner, builder, observer).
- **Out of Capture:** triage, matching, claiming, delivery assessment,
  development, acceptance, delivery, publication review, value measurement
  (dropped for now), build plans, build results, GitHub-issue intake. (Later,
  [ADR-004](ADR-004-build-results.md) brought build results in: they move a
  request to Building, then Released.)
- **Distribution:** an optional "Browse existing apps" link from
  `DISTRIBUTION_URL`, hidden when unset. Nothing else.
- **Migration:** the swamp extension and `puddleworks-ui` keep running until
  cut-over. Existing requests are imported once from swamp snapshots; after
  that, both old systems stay read-only as the rollback, then are retired.

Rails was kept only as a learning exercise, so it carries no weight here. The
rules worth keeping are already TypeScript.

## Consequences

**Good:**

- Capture starts, runs, tests and deploys with Node and Postgres only
- Web and phone share one API, one auth model and one set of schemas
- Approval is tied to a signed-in user, not a typed email

**Trade-offs:**

- The 18-state lifecycle and its history are not carried forward as live
  behaviour; old requests keep it only as read-only history
- Factory must learn `outcome-spec/v1`, a format with no typed inputs or
  delivery method, so a builder adds those on the Factory side
- Two toolchains in this repository (Deno for the swamp extension, Node for the
  product) until the extension is removed at cut-over. It was removed on
  2026-10-22; Deno now only formats the docs

The plan, API and migration steps are in
[docs/architecture/standalone.md](../architecture/standalone.md).
