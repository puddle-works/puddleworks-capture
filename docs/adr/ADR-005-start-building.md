# ADR-005: A builder can start building before there is a build result

## Status: Proposed (2026-11-08)

Changes one line of [ADR-004](ADR-004-build-results.md), which made
`record_build_result` the only way into Building.

## Context

ADR-004 moved a request to Building only when a build result arrived. The
Factory writes the first result after it has pushed a draft, so for the whole
time a builder is working, the request still said Agreed. The person who asked
couldn't tell that anyone had started, and the builder had no way to say so.

## Decision

- **`start_building` moves an agreed request to Building.** It is a method of
  its own, with its own permission, `startBuilding`, because starting work and
  reporting a build are different acts. The `build` transition and its history
  entry are the ones a result already used.
- **Only a builder may start.** Starting says the work is under way, which is
  the builder's to say, so the outcome owner, observers and reviewers can't. The
  outcome owner and a builder may still record a build result, as before, which
  also moves an Agreed request to Building. Someone who asked for the app and
  builds it alone has no builder role on it, so their first result is what moves
  it.
- **Only from Agreed.** A Building request has started already, and a Released
  one is taken back to Building by a newer build that isn't released, as before.
  Asking again is refused, not ignored, so the history shows who started.
- **A result still decides Released.** Recording a result on a Building request
  keeps it Building, with no second transition, until the latest build is
  published and every recipe example passed. `record_build_result` still moves
  an Agreed request straight to Building or Released, so a factory that never
  calls `start_building` works as before.
- **Revise and withdraw are unchanged.** Revise from Building goes back to
  discussing; once the new version is agreed, `start_building` or a result for
  it moves it on again. Building can be withdrawn.
- **Capture doesn't know why.** It takes the builder's word that work has
  started, as it takes a result's `examples`. Nothing in it names the Factory.

## Consequences

**Good:**

- The request shows Building while the work is under way, not after
- No change to the `build-result/v1` contract, or to Released
- Older requests and factories work as they did

**Trade-offs:**

- A request can be Building with no build result on it, so the page's Build
  section says nothing has been built yet
- Starting is a claim Capture can't check. A request started and then abandoned
  stays Building until it is withdrawn or revised
