# Puddleworks Capture as a standalone product: assessment and plan

Status: **retired 2026-10-27**. The Node app this plan describes was replaced by
the swamp extension ([ADR-003](../adr/ADR-003-capture-swamp-extension.md)) and
its code deleted; this is kept as the record of what it was. Approved 2026-10-22
([ADR-002](../adr/ADR-002-capture-standalone.md)). The decisions are in §9.
Written from a read of `~/dev/puddleworks-capture` (main @ 340e7cf),
`~/dev/puddleworks-ui` (main @ d2ccf6f) and their live data.

---

## 1. What exists today

Capture is currently split across two repositories, and neither is standalone.

### 1a. `puddleworks-capture`: the business logic (TypeScript, runs inside swamp)

A swamp extension package. All of Capture's rules live here:

| Part                                                     | Size                | What it holds                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extensions/models/request.ts`                           | 3,294 lines         | The 18-state lifecycle, the transition table, 30 methods (`draft`, `submit`, `requestClarification`, `triage`, `specify`, `recordSpecification`, `reviewSpecification`, `approve`, `exportSpec`, `deliver`, `retrospective`, `reopen`, …), approval gates, audit trail (`transitions[]`), legacy-shape upgrades |
| `extensions/contracts/app_spec_v1.ts`                    | 202 lines           | The exported spec (zod schemas, `specificationProblems`, `toAppSpec`)                                                                                                                                                                                                                                           |
| `extensions/contracts/build_result_v1.ts`, `lib/*`       | ~550 lines          | Build-result intake from Factory, request snapshots, lifecycle metrics                                                                                                                                                                                                                                          |
| `extensions/reports/notify.ts`                           | 201 lines           | Pushes every request change to the Rails UI                                                                                                                                                                                                                                                                     |
| `extensions/models/github_intake.ts`, `puddle_intake.ts` | ~460 lines          | Turn GitHub issues / UI form rows into requests                                                                                                                                                                                                                                                                 |
| Tests                                                    | ~6,000 lines (Deno) | Unit, whole-lifecycle graph tests, contract tests                                                                                                                                                                                                                                                               |
| Workflows, grants, 3 Claude skills                       |                     | `start-development`, `e2e-lifecycle`; who may call which method on swamp serve                                                                                                                                                                                                                                  |

Written in plain TypeScript + zod 4. The swamp coupling is thin and in one
place: every method reads/writes through `context.readResource`,
`context.writeResource`, `context.globalArgs` and `context.tagOverrides`.
Persistence is swamp's versioned data store; identity is swamp serve's token
principal; access control is swamp grants YAML.

### 1b. `puddleworks-ui`: the web front end (Rails 8, Postgres)

A read-only **projection** of swamp data plus an intake form:

| Feature                       | How                                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in                       | Rails 8 generated auth: email + bcrypt password, cookie session (30 days), no sign-up, accounts made by rake task                                                                                                      |
| Request board                 | `app_requests#index`, grouped Pending / Active / Draft / Delivered / Closed                                                                                                                                            |
| Request page                  | Timeline of transitions (who, when, approval used), latest spec review, latest build plan (raw markdown), publication scan, example files, "Run this app" link to Distribution (`DISTRIBUTION_URL`, hidden when unset) |
| Intake form                   | Creates a `pending` row; a Claude skill (`/puddle-intake`) later turns it into a swamp request                                                                                                                         |
| `POST /api/v1/swamp_events`   | Bearer-token ingest from swamp's notify report; projects into tables                                                                                                                                                   |
| `GET /api/v1/intake_requests` | Bearer-token feed of pending rows for the intake skill                                                                                                                                                                 |
| `rake puddle:resync`          | Shells out to `swamp` to rebuild the projection                                                                                                                                                                        |
| Deploy                        | Dockerfile + Kamal config (placeholder server), `/up` health check                                                                                                                                                     |

Tables: `app_requests`, `transitions`, `specification_reviews`, `build_plans`,
`publication_scans`, `swamp_events`, `workflow_runs` (unused), `users`,
`sessions`, Active Storage. Live data (`puddle_ui_main_development`): 12
requests (11 from swamp, 1 pending intake), 82 transitions, 1 user, 0 files. 226
Rails tests.

The Rails app holds almost no business rules: state labels and grouping, intake
validation, sign-in. Every rule about how a request moves lives in `request.ts`.

### 1c. History worth knowing

`puddleworks-ui` was rewritten in Next.js/TypeScript (#50, Sep 2026, 202 files)
and restored to Rails two weeks later (#68/#70, decided 2026-09-25). The issue
records the decision but not the reason; it was a way to learn Rails, so it
carries no weight in §2.

### 1d. Dependencies on Swamp, Factory and Distribution

| Dependency                                              | Where                                                                                                                                  | Fate                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| swamp runtime, data store, versioning                   | `request.ts` (`context.*`), all methods                                                                                                | Replace with Postgres + a repository layer                                    |
| swamp serve tokens, grants, principals                  | `grants/`, `requesterPrincipal`, `initiatedBy`                                                                                         | Replace with Capture's own auth + per-request roles                           |
| swamp workflows                                         | `start-development`, `e2e-lifecycle`                                                                                                   | Drop (start-development is Factory's hand-off); e2e becomes a Playwright test |
| swamp notify → Rails projection                         | `notify.ts`, `swamp_events`, `puddle:resync`                                                                                           | Disappears: one app, one database                                             |
| Factory                                                 | `recordBuildResult`, `build_result_v1`, `implementationRef`, `recordPlan`/build plans, `develop`                                       | Out of Capture; export is the hand-off                                        |
| Distribution                                            | `entryPointRef`, `amendEntryPoint`, `requesterAccess`, delivery method, "Run this app" link, publication review, `internalCollectives` | Out of Capture, except one optional link (§4)                                 |
| GitHub intake via `gh` CLI                              | `github_intake.ts`                                                                                                                     | Out of scope                                                                  |
| Claude skills (`new-puddle`, `puddle`, `puddle-intake`) | `.claude/skills/`                                                                                                                      | Become API clients later, or retire                                           |

### 1e. Gaps against the brief

- **No discussion feature exists.** Clarification today is one `question` string
  on `requestClarification`; the real conversation happens in Claude sessions
  and GitHub issues. Discussion is net new.
- **Specification is app-shaped, not outcome-shaped.** It has purpose, typed
  inputs, output, out-of-scope, settings (swamp workflow inputs and vault
  settings). The brief wants problem statement, desired outcome, scope,
  constraints, assumptions, acceptance criteria, open questions. Some of these
  exist elsewhere on the request (`problemDescription`, `currentProcess`,
  `constraints`, `assessment`) and can seed the new shape.
- **Approval is weak.** Without a swamp principal, `approve` only checks that
  the typed email matches the requester. Real server-side identity fixes this.
- **No API a mobile client can use.** The Rails app is HTML + two
  machine-to-machine endpoints.
- **Lifecycle is the whole Puddleworks journey** (18 states, through delivery,
  publication and value measurement), not Capture's 5.

---

## 2. Options compared

|                         | A. Next.js                                                                                    | B. Vite React + Hono API (TypeScript)                                        | C. Rails API + new front end                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Reuse of business logic | Ports `request.ts` (TS → TS)                                                                  | Ports `request.ts` (TS → TS)                                                 | Rewrite 3,300 lines of rules + 6,000 lines of tests in Ruby           |
| Reuse of Rails app      | Sign-in, views, schema rewritten                                                              | Same                                                                         | Keeps sign-in, intake, schema                                         |
| Mobile fit              | Risky: server actions, RSC and cookie sessions pull the web away from the API the phone needs | Good: the API is the only door, web and phone use it the same way            | Workable, but no shared types; Expo client needs codegen from OpenAPI |
| Shared TS with Expo     | Yes, with discipline                                                                          | Yes, by construction (`packages/domain`, `packages/api-client`)              | No                                                                    |
| OpenAPI                 | Hand-written or bolt-on                                                                       | Generated from the zod schemas the domain already uses (`@hono/zod-openapi`) | rswag, hand-maintained                                                |
| Operations              | One Node process + Postgres                                                                   | One Node process + Postgres (API also serves the built web app)              | One Ruby process + Postgres (+ a JS build for the new front end)      |
| Testability             | Good (Vitest, Playwright)                                                                     | Good (Vitest on domain and API, Playwright)                                  | Good (Minitest), but two languages                                    |
| Development speed       | Fast to start, slower to keep API-clean                                                       | Slightly more setup, then fast                                               | Fast for the existing screens, slow for the new domain                |
| Cost                    | Same container, same DB                                                                       | Same                                                                         | Same                                                                  |
| Already tried           | Yes, reverted (#68)                                                                           | No                                                                           | Current state                                                         |

### Recommendation: **B, as one deployable**

- The valuable asset is the TypeScript domain in `request.ts` and its tests, not
  the Rails views. B keeps that asset in its language; C throws it away and
  rewrites it in Ruby. A keeps it but invites web-only shortcuts the phone can't
  use.
- "Separate API" doesn't mean two services. One Node process serves `/api/v1/*`
  and the built React app from `/`. One container, one Postgres, deployed with
  the Kamal setup the Rails app already has.
- The API is the only way in for the web app too, so the phone gets the same
  routes, the same auth and the same rules with no backend changes (Phase 6
  becomes a check, not a project).
- zod schemas are written once and used for request validation, the OpenAPI
  document, the typed client and (later) Expo forms and offline drafts.

**Runtime:** Node 24 LTS with pnpm workspaces, not Deno. Expo and React Native
need the npm toolchain, and sharing workspace packages with an Expo app is
routine on Node.

**Libraries (all mainstream, pinned):** Hono + `@hono/zod-openapi`, zod 4,
Drizzle ORM + drizzle-kit migrations, React 19 + Vite + React Router + TanStack
Query, pino logging, Vitest, Playwright. Auth library: see §5.

---

## 3. Proposed repository structure

Built in `puddleworks-capture` (the product's name), on a feature branch, next
to the swamp extension until cut-over; the extension is then removed (done
2026-10-22). `puddleworks-ui` is archived after cut-over, read-only, as the
rollback.

```
puddleworks-capture/
  apps/
    api/                 # Hono: routes (entrypoints), auth, OpenAPI, serves web build
      src/
        http/routes/     # thin HTTP handlers, one file per resource
        auth/            # Better Auth; addUser for invite-only accounts
        db/              # Drizzle schema; migrations in apps/api/drizzle/
        adapters/        # repositories (Postgres)
        service_layer/   # use cases: submit, postMessage, agree, export…
        scripts/         # migrate, add a user, write the OpenAPI document
        app.ts, server.ts, config.ts, deps.ts
      openapi/capture.v1.json  # generated, committed; a test fails if stale
      test/              # service tests with a fake repository; HTTP tests on Postgres
    web/                 # Vite + React; talks only to /api/v1 via packages/api-client
  packages/
    domain/              # pure TS: entities, lifecycle, spec rules, zod schemas. No I/O.
    api-client/          # typed client generated from the OpenAPI document
    contracts/           # export format: outcome-spec/v1
  e2e/                   # Playwright: the primary journey
  scripts/import-legacy/ # one-off: swamp snapshots + Rails rows → Postgres
  docs/                  # ADR-002 (standalone), architecture, deploy, migration
  Dockerfile, config/deploy.yml (Kamal), .github/workflows/ci.yml
```

`packages/domain` → `service_layer` → `adapters`/`routes` follows the
ports-and-adapters layering the global instructions ask for. A test (like
today's `standalone_test.ts`) fails the build if anything imports swamp, reads
`.swamp`, or names `@mesgme/`/`vault.get`.

---

## 4. Domain design

### Entities

**Request**: `id` (UUID, client may supply it for offline drafts), `title`,
`initialDescription`, `currentProcess` (kept from today's intake),
`outcomeOwnerId`, `status`, `createdAt`, `updatedAt`, `closedReason?`.

**Participant**: `requestId`, `userId`, `role` ∈
`outcome_owner | builder |
observer`, `invitedBy`, `joinedAt`. Permissions come
from role, checked on the server:

| Action                         | Outcome owner | Builder              | Observer |
| ------------------------------ | ------------- | -------------------- | -------- |
| Read request, discussion, spec | ✓             | ✓                    | ✓        |
| Post message, ask question     | ✓             | ✓                    | –        |
| Resolve a question             | ✓             | ✓                    | –        |
| Edit spec draft                | ✓             | ✓                    | –        |
| Mark ready for agreement       | ✓             | ✓                    | –        |
| **Agree**                      | ✓ only        | –                    | –        |
| Invite / remove participants   | ✓             | invite builders only | –        |
| Withdraw                       | ✓             | –                    | –        |
| Export                         | ✓             | ✓                    | –        |

**Message**: `id`, `requestId`, `authorId`, `kind` ∈
`comment | question |
decision`, `body`, `createdAt`, `editedAt?`, and for
questions `resolvedAt?`, `resolvedBy?`, `resolutionMessageId?`. Open questions =
unresolved `question` messages; the spec's "open questions" section is generated
from them, not typed twice.

**OutcomeSpecification** (versioned, append-only): `requestId`, `version` (1, 2,
…), `problemStatement`, `desiredOutcome`, `scope: {in[], out[]}`,
`constraints[]`, `assumptions[]`, `acceptanceCriteria[]` (each `{id, text}`),
`status` ∈ `draft | proposed |
changes_requested | agreed | superseded`,
`basedOnMessageIds[]` (which discussion points produced this change),
`createdBy`, `createdAt`. Only the latest `draft` is editable; editing uses
optimistic concurrency (`If-Match: <etag>`). Proposing freezes it; asking for
changes marks it `changes_requested` and the next edit starts a new version.

**Agreement**: `requestId`, `specVersion`, `agreedBy`, `agreedAt`, `specHash`
(SHA-256 of the canonical JSON, so "what was agreed" is provable).

**Transition** (audit trail, carried over from today): `from`, `to`, `by`, `at`,
`note`.

**Export**: `requestId`, `specVersion`, `format`, `exportedBy`, `exportedAt`.

### Lifecycle

```
Draft ──submit──▶ Discussing ──propose──▶ Ready for agreement ──agree──▶ Agreed ──export──▶ Exported
  │                  ▲   │                      │                          │                 │
  │                  │   └────── withdraw ──────┴──────── (owner) ─────────┤                 │
  │                  └──────── request changes / revise ◀──────────────────┴─────────────────┘
  └─ withdraw
```

- **Draft**: owner only, not visible to builders.
- **Discussing**: builders can join; messages and spec drafts.
- **Ready for agreement**: a spec version is `proposed` and frozen. Owner
  agrees, or asks for changes (back to Discussing, new draft version).
- **Agreed**: agreement recorded against an exact spec version + hash.
- **Exported**: at least one export made. Export again any time.
- **Revise** from Agreed/Exported: opens a new draft version; the old agreement
  and exports stay in history, marked `superseded` only when a new version is
  agreed.
- **Withdrawn** (terminal, owner) and **Declined** (terminal, builder says
  "won't take this").

These rules live in `packages/domain/lifecycle.ts` as a transition table + guard
functions, ported from today's `VALID_TRANSITIONS`/`assertApproval` pattern,
with the whole-graph tests ported from `request_lifecycle_test.ts`.

### Export formats

- `puddleworks.dev/outcome-spec/v1`: Capture's own neutral JSON (request, agreed
  spec, agreement, participants by role, open questions = none or listed), with
  `request.url` linking back to the request's page (`APP_URL` +
  `/requests/{id}`). Versioned like today's contracts, with an example file and
  a contract test.
- Markdown: the same, readable, for pasting into any process.
- No `app-spec/v1`. Typed inputs and delivery method are an implementation
  concern; Factory (or any other process) reads `outcome-spec/v1` and adds them
  on its side.

### Distribution link

`DISTRIBUTION_URL` (optional). When set, the web app shows "Browse existing
apps" in the header and on the new-request page ("Something might already do
this"). Unset: hidden. No search, no API call.

---

## 5. Authentication and API

### Auth (same model for web and phone)

- Capture is its own identity provider for v1, using an established library
  (**Better Auth**, which supports email + password, magic links, OAuth
  providers, bearer tokens and an Expo integration), not hand-rolled crypto.
- **Web**: httpOnly, `Secure`, `SameSite=Lax` session cookie set by the API on
  the same origin, with Origin-header checks on writes (CSRF).
- **Phone (later)**: authorisation-code flow with PKCE through the system
  browser, short-lived access token + rotating refresh token, stored in
  `expo-secure-store`. Same users, same roles, same routes.
- Every route checks the caller's role on that request on the server. React
  never decides permissions; it only hides buttons the API would refuse.
- Existing users move across: Rails `password_digest` is bcrypt, which the Node
  side verifies directly, so nobody resets a password.
- Sign-up stays closed (invite only) as today.

### API (v1, JSON, cursor pagination, ETags)

```
GET    /healthz                         liveness
GET    /readyz                          DB reachable
POST   /api/v1/auth/*                   sign-in, sign-out, token refresh (library-provided)
GET    /api/v1/me
GET    /api/v1/config                   {distributionUrl}; no sign-in needed
GET    /api/v1/openapi.json             this API, described

GET    /api/v1/requests?scope=&status=&cursor=&limit=  mine, or (builders) available to join
POST   /api/v1/requests                             create draft (Idempotency-Key honoured)
GET    /api/v1/requests/{id}
PATCH  /api/v1/requests/{id}                        title/description while Draft
POST   /api/v1/requests/{id}/submit | withdraw | propose | request-changes | revise | join | decline

GET    /api/v1/requests/{id}/participants
POST   /api/v1/requests/{id}/participants           invite by email + role
DELETE /api/v1/requests/{id}/participants/{userId}

GET    /api/v1/requests/{id}/messages?after=&limit= chronological; poll with `after`
POST   /api/v1/requests/{id}/messages
POST   /api/v1/requests/{id}/messages/{messageId}/resolve

GET    /api/v1/requests/{id}/specification          current version (+ ETag)
PUT    /api/v1/requests/{id}/specification          edit draft (If-Match)
GET    /api/v1/requests/{id}/specification/versions
GET    /api/v1/requests/{id}/specification/versions/{v}

POST   /api/v1/requests/{id}/agreements             owner agrees to the proposed version
GET    /api/v1/requests/{id}/agreements

POST   /api/v1/requests/{id}/exports                {format}; returns the document
GET    /api/v1/requests/{id}/history                transitions + agreements + exports
```

Errors use RFC 9457 problem+json with plain-language `detail` (today's methods
already write good messages; keep them). Writes from another origin are refused
(403). `GET /requests/{id}` sends an ETag and answers `If-None-Match` with 304.
Saving the specification needs `If-Match` with the specification's ETag (428
without it, 412 if someone else saved first). `POST /requests` honours
`Idempotency-Key`.

**Storage.** Each request is one aggregate, stored as a JSONB document in
`requests` with a `version` column for optimistic locking (the service retries a
clash up to three times). `request_participants` mirrors who is on each request
so "my requests" and "available" are indexed queries. Users, sessions and
accounts are Better Auth's tables. Lists return `{items, nextCursor}`. Updates
are polling-based (`after` cursor + ETag, web polls every ~15 s on an open
request); no WebSockets.

---

## 6. Migration plan

Each phase is one or more PRs, merged by you, one at a time.

**Phase 1: Assessment** (this document). Output: approved decisions → ADR-002
"Capture is a standalone product" in `puddleworks-capture/docs/adr/`.

**Phase 2: Independence** (no behaviour change for users)

- Monorepo skeleton (`apps/`, `packages/`), CI with lint, typecheck, tests.
- `packages/domain`: the new lifecycle, roles, discussion, versioned outcome
  specification, agreement and `outcome-spec/v1` export, as pure functions with
  tests. The pattern (transition table, guard functions, plain-language errors,
  whole-graph tests) comes from `request.ts`; the 18 states do not.
- Independence test: CI runs with no swamp installed; a boundary test fails on
  any swamp import or `.swamp` path.
- Swamp extension and Rails app keep running untouched.

**Phase 3: API and domain**

- New domain (Request, Participant, Message, OutcomeSpecification, Agreement,
  Export, Transition), Postgres schema + migrations, repositories, service
  layer, Hono routes, OpenAPI generated and committed, auth.
- Legacy import script, tested against a copy of live data: swamp request
  snapshots (the migration doc's step 3 already produces them)
  - Rails `users` and the pending intake row → Postgres. State mapping:

  | Today                               | New                 | Kept as history                                                         |
  | ----------------------------------- | ------------------- | ----------------------------------------------------------------------- |
  | `draft`, `pending`                  | Draft               |                                                                         |
  | `submitted` … `delivery_assessment` | Discussing          | original state + transitions                                            |
  | `specification_review`              | Ready for agreement | review verdict as a message                                             |
  | approved, before export             | Agreed              | approval → Agreement                                                    |
  | `in_development` and later          | Exported            | delivery/publication/retrospective data in `legacy` JSON on the request |
  | `declined`, `withdrawn`             | same                |                                                                         |

  Old `specification` fields map: purpose → desired outcome, outOfScope →
  scope.out, request `problemDescription` → problem statement, `constraints` →
  constraints. Inputs/settings/delivery go to `legacy`.

  Built as `pnpm --filter @capture/api import:legacy` (see the README). Decided
  while building it (2026-10-22):
  - Requests get new UUIDs. `legacy` holds the old name, state and resources; a
    unique index on its name makes re-runs skip what is already imported.
  - `old-owner@example.com` is mapped onto `owner@example.com` with `--alias`.
  - `specification_review` with an approval for `in_development` is Agreed.
  - Requests at `in_development` or later with no old `specification` get spec
    v1 built from the request: desired outcome is the last note on entering
    `in_specification`, else the reusability note. Every agreed spec gets an
    Agreement by the outcome owner at the approval time, hashed as the service
    layer does. Exported requests have no export record: they were delivered
    before Capture had one.
  - Imported specs have no acceptance criteria or in-scope list, so revising one
    means filling those in before it can be proposed.
  - Constraints on a request with no spec are kept at the end of its
    description; builders, spec writers and reviewers become `builder`
    participants; a review becomes a message.
  - Rails users keep their bcrypt passwords: sign-in checks bcrypt hashes as
    well as Capture's own.

**Phase 4: Front end**

- React app: sign-in, my requests, new request, request page (discussion, spec
  editor with version history, agree, export), Distribution link. The request
  page lives at `/requests/{id}`: every export links there.
- Feature parity check against the Rails screens that still matter (board,
  timeline with who/when, intake fields). Example-file uploads come later.

  Built as `apps/web` (Vite + React, see the README). It talks only to `/api/v1`
  through `packages/api-client`, and the API serves its build, so there is one
  origin and the session cookie needs no CORS. The request page asks the API for
  changes every 5 seconds (a 304 when nothing changed), so a question shows up
  without reloading. Playwright walks the primary journey in CI.

  Parity with the Rails screens (2026-10-22):

  | Rails                                                       | Capture web                                                                                                                                          |
  | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Board grouped Pending / Active / Draft / Delivered / Closed | "Your requests", grouped by Capture's states in the order a request moves; builders also get "Open to join"                                          |
  | Timeline: transition, who, when, approval used              | History: every transition with who and when, agreements (version, who, hash) and exports (format, who); imported requests also show "Before Capture" |
  | Intake: title, problem, current process                     | Kept, and editable while the request is a draft or being discussed                                                                                   |
  | Intake: frequency, effort                                   | Dropped with value measurement (§9)                                                                                                                  |
  | Intake: prefers local                                       | Dropped: how an app runs is Factory's and Distribution's business                                                                                    |
  | Intake: constraints                                         | Moved to the specification                                                                                                                           |
  | Intake: example files                                       | Later                                                                                                                                                |
  | Spec review, build plan, publication scan                   | Gone: discussion and agreement replace the review; the rest belongs to Factory and Distribution                                                      |
  | "Run this app" link                                         | "Delivered apps" in the header, from `DISTRIBUTION_URL`, hidden when unset                                                                           |

**Phase 5: Deployment and cut-over**

- Dockerfile (multi-stage, non-root), Kamal config, `/healthz` `/readyz`, pino
  JSON logs with request ids, secure headers, rate-limited sign-in, CORS
  allowlist, env-only config (`DATABASE_URL`, `SESSION_SECRET`, `APP_URL`,
  `DISTRIBUTION_URL`, mail settings).
- Cut-over: freeze swamp request methods → snapshot → import → verify counts and
  a field-by-field check (like today's migration step 6) → point users at the
  new URL.
- **Rollback**: the Rails app, its database and swamp data are left untouched
  and read-only; switching back is re-pointing the URL. Anything done in the new
  app after cut-over would need re-entering, so keep the overlap short.

  Cut over on 2026-10-22, on this Mac rather than a server, so there is no
  Dockerfile or Kamal config; the README's "Run Capture on this Mac" says how it
  runs. The steps:

  1. Freeze: the Rails app was stopped, and request methods are no longer run in
     the Puddleworks repository. swamp serve keeps running for delivered apps.
  2. Snapshot: the 12 swamp requests, from a copy of the repository; the Rails
     database through a `pg_dump` copy.
  3. Import into `capture_prod`: 1 person (the old `old-owner@example.com`
     mapped onto `owner@example.com`) and 13 requests, the 12 snapshots plus 1
     intake row still pending (8 draft, 1 discussing, 1 ready for agreement, 1
     agreed, 2 exported). A second run imported nothing.
  4. Verify: `scripts/verify-legacy-import.sh` passed for all 13. The Rails rows
     are a partial copy of the swamp data and differ in two places, where the
     snapshot was kept: `migrate-claude-to-codex` is `draft` in Rails but
     `publication_decided` in swamp, and `reading-notes-pipeline` has an older
     title. `todo-triage-workflow` was never in Rails.

**Phase 6: Mobile readiness**

- Scripted check that a non-browser client can sign in with PKCE, list requests
  with pagination, post a message and fetch a spec using only
  `packages/api-client`. Add the `capture://requests/{id}` scheme and
  `/.well-known/apple-app-site-association` route stub. No app built.

---

## 7. Testing

| Area                                                       | How                                                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle, permissions, spec versioning, agreement, export | Vitest unit tests on `packages/domain` (ported + new), table-driven over every edge like today's graph test                                        |
| Repositories, migrations                                   | Vitest integration tests against a real Postgres (per-worktree DB, as the Rails app does today)                                                    |
| API + auth                                                 | Integration tests via Hono's in-process `app.request`: every route refuses the wrong role and no-session                                           |
| API contract                                               | Committed OpenAPI must equal the generated one (CI fails on drift); client compiles against it                                                     |
| Export                                                     | Contract tests against committed example files                                                                                                     |
| Independence                                               | CI job with no swamp binary; boundary test for imports and strings                                                                                 |
| Primary journey                                            | Playwright: owner signs up/in → creates → submits → builder joins → question asked and resolved → spec edited → proposed → owner agrees → exported |
| Legacy import                                              | Run against a copy of live data; every request accounted for                                                                                       |

---

## 8. Future iPhone app (how it will plug in)

An Expo app in `apps/mobile` imports `packages/domain` (zod schemas for forms
and offline drafts) and `packages/api-client` (typed calls). It signs in with
the same accounts via authorisation code + PKCE in the system browser and keeps
tokens in the device keychain. It uses the same `/api/v1` routes with cursor
pagination. Deep links use the same paths as the web app (`/requests/{id}`).
Push notifications later add a `devices` table and an Expo push sender behind
the existing service layer. Offline drafts work because `POST /requests` accepts
a client-made UUID and an Idempotency-Key. No UI components are shared with the
web app.

---

## 9. Decisions (2026-10-22)

1. **Stack: option B.** The Rails app was a way to learn Rails, not a
   constraint.
2. **Value measurement is dropped for now**, with the rest of the list in §1d
   (triage, matching, claiming, delivery assessment, development, acceptance,
   delivery, publication, build plans, GitHub-issue intake). Old requests keep
   that data as read-only history.
3. **One neutral spec**, `outcome-spec/v1`, that anything can pick up. No
   `app-spec/v1` adapter.
4. **Better Auth.**
5. **Node**, not Deno.
6. Defaults taken: keep **Declined**; sign-up stays **invite only**;
   example-file uploads are **left out of v1** (none are in use) and can come
   back later.
