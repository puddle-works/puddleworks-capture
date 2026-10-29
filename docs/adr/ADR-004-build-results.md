# ADR-004: Capture records build results: Building, then Released

## Status: Accepted (2026-10-29)

Changes one line of [ADR-002](ADR-002-capture-standalone.md), which put build
results out of Capture. Agreeing is still the hand-off; this adds what comes
back.

## Context

Agreeing writes the outcome spec, and a factory builds from it. Until now
Capture never heard what happened next, so an agreed request looked the same
whether nothing was built, a build was under way or the app was out. The person
who asked had to be told some other way.

The Factory already writes `puddleworks.dev/build-result/v1` after a build: the
repository, branch and pull request, what was published, and the outcome spec's
`source` (its request page, version and spec hash). Its contract lets readers
ignore fields they don't know, and lets writers add optional ones.

Every spec has a recipe whose examples say what the app must answer (issue #7).
Those are what decide whether a build is done.

## Decision

- **Two statuses after Agreed: Building and Released.** They are statuses, not
  records alone like an export, because they change what the request is: work
  has started, or the app is out. The list shows them as their own groups.
- **One method moves them: `record_build_result`.** The `build` and `release`
  transitions are taken only by recording a result, never asked for alone. The
  outcome owner or a builder may record one.
- **The result says which request it is for.** Its `source.url` must be
  `<appUrl>/requests/<id>`, and its `source.version` and `source.specHash` must
  be the agreed version's. A result built from anything else is refused.
- **The latest build stands.** The one with the latest `builtAt` for the agreed
  version decides the status, whatever order results come in. The same result
  twice changes nothing.
- **Released needs passing examples.** The build must be published, and its
  optional `examples: [{ phrase, passed, detail? }]` must report every example
  in the agreed recipe as passed, the requested phrase among them. This field is
  an addition to build-result/v1 the Factory hasn't written yet
  (puddle-works/puddleworks-factory#45); until it does, a build stays Building
  and the log names the examples not reported. A spec agreed before recipes has
  no examples, so it is revised before it can be released.
- **Neither status is the end.** A newer build that isn't released takes a
  Released request back to Building. Revise works from Building or Released, as
  from Agreed, and the results recorded stay on the request. Building can be
  withdrawn; Released can't, as the app is already out.
- **Capture reads the contract with its own copy.** `build_result_v1.ts` has the
  Factory's field rules plus `examples`, and drops fields it doesn't know.
  Capture still imports nothing from the Factory; a test reads the Factory's
  example file, which CI checks out from the Factory's main.
- **The page links out.** The latest build shows its repository, branch, pull
  request, published version and registry page,
  `https://swamp-club.com/extensions/<extension>`, with how each example came
  out. Only https links are taken.

## Consequences

**Good:**

- The person who asked can see their request move on after agreement, and where
  the app is once it is out
- Released means the agreed phrases were answered, not only that something was
  published
- Any factory that writes build-result/v1 with the request's `source` can report
  back; nothing in Capture names the Factory

**Trade-offs:**

- The examples are what the build reports about itself; Capture doesn't run the
  recipe. That is the same trust `as` already asks for
- Nothing is released until the Factory writes `examples`
- Capture's copy of the contract can fall behind the Factory's. The contract
  test catches a change that breaks reading the Factory's example, not a new
  field Capture ignores
