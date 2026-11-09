# ADR-006: A web UI is Preact rendered on the server

## Status: Proposed (2026-11-09)

The same rule is in puddle-template (README and `CLAUDE.md`), builder-workbench
(`CLAUDE.md`) and puddleworks-factory, word for word. Capture's page already
works this way, so nothing in Capture changes.

## Context

ADR-002 gave Capture a React web app on a Node server. ADR-003 replaced it with
a read-only Preact page served by `@puddleworks/capture/web`. That page is now
rendered on the server, from `extensions/models/_lib/web/page/`.

No guidance for builders named a UI stack, so an app built from a request could
use any of them, Rails included. Mark decided that every web UI is React or
Preact, not Rails.

A page that ships inside a swamp extension has to pass the registry's file
check. In swamp, `src/domain/extensions/extension_safety_analyzer.ts` allows
only `.ts`, `.json`, `.md`, `.yaml`, `.yml` and `.txt` files. Both
`swamp extension push` and `pull` refuse any other type. A `.tsx` file is
refused, so a page can't be written in JSX.

## Decision

A web UI is Preact rendered on the server, written with `h()` in `.ts`, because
the swamp registry rejects `.tsx`.

Capture's page shows how:

- Components are functions that call `h()` from `preact`.
  `preact-render-to-string` turns them into HTML for each request. Both are
  pinned: `npm:preact@10.27.3` and `npm:preact-render-to-string@6.8.2`.
- The page's small browser script opens "Show all" and reloads the page when the
  data changes. Nothing is rendered in the browser. `web/build.ts` bundles the
  script, HTML, CSS and icon into `extensions/models/_lib/web/assets.ts`, in
  lines short enough for the registry's long-line check.

## Consequences

**Good:**

- The apps share one UI stack, so a page reads the same in every repository
- A page ships inside its extension and passes the registry's file check
- No Rails app, Node server or browser app to run beside swamp

**Trade-offs:**

- `h()` calls are wordier than JSX
- Capture's page only reads. No page yet shows how this stack handles forms or
  sign-in, which a page such as Distribution's run form needs
