# ADR-004: Capture records build results: Building, then Released

## Status: Accepted (2026-10-29)

Amended by [ADR-005](ADR-005-start-building.md): `start_building` also moves an
agreed request to Building, before any result.

Amended (2026-11-09, issue #27): a pass counts only with evidence that
puddlerouter answered the phrase, all with one recipe. Each example carries
`recipeId` and `router: { testedAt, version, outcome, source }`, optional
build-result/v1 fields agreed with the Factory (factory#78). Released needs the
same `recipeId` on every example and `router.version` equal to
`published.version`. `router.source` is shown, not checked, so a recipe built
for another request can answer this one (factory#55's reused recipe).

Amended (2026-11-10, issue #27, factory#78): Mark decided the person who asked
runs the router test, `whenEmpty` must match exactly, and the result moves to
build-result/v2. This replaces the 2026-11-09 amendment:

- **The outcome owner records the router test in Capture**, with
  `record_router_test`: the version installed on their desk and, per agreed
  phrase, `answered`, `answered-after-yes` or `not-answered`, with a note. A
  builder can't record one. Each test replaces the last for that version.
- **build-result/v2 carries the recipe as published**:
  `recipe: { id, phrases,
  empty }`, copied from the recipe tag. It has no
  `router` or `recipeId`.
- **Released needs** the builder's checks to pass as before, a published v2
  whose `recipe.phrases` has every agreed phrase as written and whose
  `recipe.empty` is the agreed `whenEmpty` (ends trimmed), a `whenEmpty` that
  isn't blank, and the outcome owner's latest test of the published version
  answering every agreed phrase. `record_router_test` can release a request too,
  and a failing retest takes it back to Building.
- **v1 is still read** and its builder-reported `router` evidence is shown as
  such, but a v1 result can't release a request, as it carries no recipe.
  Requests already Released stay as they are.

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
  an addition to build-result/v1. The Factory has written it since
  puddle-works/puddleworks-factory#45 closed on 2026-11-05, and its example
  result has it. A result without it stays Building, and the log names the
  examples not reported. A spec agreed before recipes has no examples, so it is
  revised before it can be released.
- **Neither status is the end.** A newer build that isn't released takes a
  Released request back to Building. Revise works from Building or Released, as
  from Agreed, and the results recorded stay on the request. Building can be
  withdrawn; Released can't, as the app is already out.
- **Capture reads the contract with its own copy.** `build_result.ts` has the
  Factory's field rules for v1 and v2, and drops fields it doesn't know. Capture
  still imports nothing from the Factory; a test reads the Factory's example
  files, which CI checks out from the Factory's main.
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
  recipe. That is the same trust `as` already asks for. The Factory's come from
  its readiness check, which shows a phrase reaches the app, not that the answer
  is right, unless the builder passes outcomes they checked
- Nothing is released from a result without `examples`, such as one from a
  factory that doesn't write them
- Capture's copy of the contract can fall behind the Factory's. The contract
  test catches a change that breaks reading the Factory's example, not a new
  field Capture ignores
