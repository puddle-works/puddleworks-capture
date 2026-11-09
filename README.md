# puddleworks-capture

Captures requirements: takes a request, discusses it, agrees the outcome and
exports a spec. It doesn't build anything, but it records what a factory built
from the spec and when that was released.

One of three separate Puddleworks applications: Capture, Factory and
Distribution. Each runs alone and can be swapped out. They share no code, only
versioned file contracts. See [ADR-001](docs/adr/ADR-001-three-separate-apps.md)
and the epic puddle-works/puddleworks#207.

| Takes in                              | Puts out                  |
| ------------------------------------- | ------------------------- |
| a request                             | an `outcome-spec/v1` file |
| a `build-result/v1` file from a build | Building, then Released   |
| a builder starting work               | Building                  |

Capture is the swamp extension `@puddleworks/capture`
([ADR-003](docs/adr/ADR-003-capture-swamp-extension.md)): requests and people
live in swamp data, every change is a behavior method, and a small read-only
page shows them. Its code is in `extensions/models/` and `web/`.

It replaced a Node app ([ADR-002](docs/adr/ADR-002-capture-standalone.md),
[plan](docs/architecture/standalone.md)), now retired. Capture never imports
Factory or Distribution; `tests/independence_test.ts` fails if it does.

Building the app is a factory's job (such as
[puddleworks-factory](https://github.com/puddle-works/puddleworks-factory)), and
putting it in front of people is
[puddleworks-distribution](https://github.com/puddle-works/puddleworks-distribution)'s.

## The swamp extension

| Type                                          | What it does                                                        |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `@puddleworks/capture/requests`               | The people list and every request, and the methods that change them |
| `@puddleworks/capture/web`                    | `serve`: the read-only page on 127.0.0.1                            |
| `@puddleworks/capture-log-request` (workflow) | Logs a request from a program, once per `sourceRef`                 |
| `@puddleworks/capture-review-spec` (workflow) | Has an agent review the spec up for agreement                       |

Set it up in a swamp repository:

```bash
swamp extension pull @puddleworks/capture
swamp behavior create @puddleworks/capture/requests capture \
  --global-arg defaultAs=olive@example.com --global-arg appUrl=http://127.0.0.1:3002
swamp behavior run capture add_person --input email=olive@example.com \
  --input name="Olive Owner" --input builder=true
swamp behavior create @puddleworks/capture/web viewer
swamp behavior run viewer serve --input port=3002   # until Ctrl-C; open http://127.0.0.1:3002
```

`appUrl` is where the page is served; exported outcome specs link to
`<appUrl>/requests/<id>`.

The page is for people to look at. `serve` renders it as HTML on the server, and
it answers no request data as JSON, so there is no API to script against. A
script or an agent reads requests through the methods (`get_request`,
`list_requests`) or with `swamp data query`, where Capture's rules decide what
the person acting may see; a draft, for one, is its outcome owner's alone.

### Who acts

Every method acts as one person in the people list: `--input as=<email>`, or the
behavior's `defaultAs` when `as` is left out. Their role on the request decides
what they may do, as before: the outcome owner submits, agrees, withdraws and
exports; builders join open requests, write the specification and record what
they built; reviewers ask questions and ask for changes; observers read.
Agreeing waits until every question is resolved. Agreeing is the hand-off: it
writes the agreed version as an `outcomeSpec` document (`outcome-spec-<id>`) for
the builder, and the request stays Agreed. There is no sign-in, so anyone who
can run swamp in the repository can act as anyone on the list.

```bash
swamp behavior run capture create_request --input title="Weekly stock counts" \
  --input description="We copy counts from paper every Friday." --input idempotencyKey=turn-3f9a
swamp behavior run capture list_requests --input scope=available --input as=bea@example.com
swamp behavior run capture join_request --input id=12 --input as=bea@example.com
swamp behavior type describe @puddleworks/capture/requests --json   # every method and its inputs
```

Every request has a number: #1 for the first, then one more for each, so people
can say which one they mean. The page shows it before the title, and every
method's `id` takes the number (`12` or `#12`) as well as the request's id, as
does the page's address (`/requests/12`). Requests saved before numbers get
theirs, oldest first, on the next `create_request` or `import`.

### Every spec has a recipe

A specification says what the request needs, and its recipe says what must
answer it: the phrases someone will ask (`examples`, each with what the answer
shows), what to answer when there is nothing to show (`whenEmpty`), any pieces
taken from the phrase (`pieces`, each an `int`, `repo` or `word`), and
extensions to start from (`candidateExtensions`). It says what, not how. A spec
can't be proposed until its recipe has at least one example and every example
has an answer.

A request raised with the phrase it was asked as (`create_request`'s `phrase`)
keeps it as `requestedPhrase`. Its draft spec starts with that phrase as the
recipe's first example and an `R1` acceptance criterion naming it. The phrase is
the requirement: an edit that rewords it or moves it from first is refused, and
the spec can't be proposed while no criterion names it. Other phrasings can be
added after it. An `edit_specification` that leaves the recipe out keeps the one
already there. The exported `outcome-spec/v1` carries the recipe and the
requested phrase as optional fields, and the Markdown has a Recipe section.

```bash
swamp behavior run capture create_request --input title="Weekly stock counts" \
  --input description="We copy counts from paper every Friday." \
  --input phrase="what needs counting this week" \
  --input candidateExtensions='["@example/stock"]'
```

The same `idempotencyKey` from the same person always gives back the same
request. Reads (`get_request`, `list_requests`) write what they found as `view`
and `requestList` data; `agree` writes `outcomeSpec`, and `export_outcome_spec`
writes it again, or `outcomeSpecMarkdown`, recording the export without moving
the request on. A request an older Capture saved as Exported reads as Agreed.

### Revise an agreed spec, with a reason

When a builder learns that an agreed spec needs to change, they can upload the
revised spec to the same request, with a short reason, for the outcome owner to
agree. `revise_specification` does it in one step: it revises the request if it
is agreed, building or released, saves the next version with the reason as its
`changeSummary`, and proposes it. The outcome owner or a builder may run it.

```bash
swamp behavior run capture revise_specification --input as=bea@example.com \
  --input id=12 --input outcomeSpec=specs/stock-counts.outcome-spec.json \
  --input reason="The owner now wants counts from the second stockroom too."
```

Give the spec as `outcomeSpec`, an edited `outcome-spec/v1` file for this
request (a path, https URL, JSON text or object; only its `specification` is
used, and its `request.id` must be this request's), or as `specification`, as
`edit_specification` takes it. `basedOnVersion` is the version the change starts
from, and defaults to the file's `specification.version`; if a newer version
exists it is refused, so a change made to an old copy isn't proposed over a
newer one. If the spec isn't ready or questions are open, the proposal is
refused and nothing changes.

The reason shows on the version, next to its agreement and in the history, with
what changed from the version before. Once agreed, the outcome spec carries it
as the optional `specification.changeSummary`, and the Markdown says it under
the title.

### Reads or writes

A specification can also say whether the outcome only reads, or changes things,
and what it changes, so whatever acts on it knows whether to ask first. It is
part of what is agreed, so changing it after agreement takes a new version.

```json
"effects": {
  "kind": "write",
  "changes": ["deletes merged git branches", "removes git worktrees"]
}
```

`kind` is `read` or `write`; `changes` names each change in plain words, is
needed for `write` and must be empty for `read`. It is optional, and a spec
without it counts as `write`, so a missing field is never taken as safe. An
`edit_specification` that leaves it out keeps the one already there. The
exported `outcome-spec/v1` carries it as the optional `specification.effects`,
the Markdown has a "Reads or writes" section, and the page shows it with the
spec.

### Record what was built

Agreed means ready to build. A factory builds from the outcome spec and writes a
[`build-result/v1`](https://github.com/puddle-works/puddleworks-factory/blob/main/docs/contracts/build-result.md)
file. `record_build_result` records it against the request its `source.url`
names (`<appUrl>/requests/<id>`, the page the outcome spec gave), so it takes no
`id`:

```bash
swamp behavior run capture record_build_result --input as=bea@example.com \
  --input result=builds/stock-counts.build-result.json
```

`result` is a file path, relative to the repository or in full, an https URL,
JSON text or, from a workflow, an object. The outcome owner or a builder may
record one. Its `source.version` and `source.specHash` must be the agreed
version's, so a build of something else is refused.

| Status   | When                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Building | Work is started, the first result is recorded, or a newer one isn't released                                                 |
| Released | The latest build is published, and every example in the agreed recipe is reported as passed, the requested phrase among them |

When work starts, before there is any result, a builder on the request can mark
it Building:

```bash
swamp behavior run capture start_building --input as=bea@example.com --input id=1
```

It works only while the request is Agreed, and the outcome owner can't do it.
Results recorded after that keep it Building until one is released. A factory
that never calls it is unaffected: its first result moves the request to
Building, or straight to Released.

The latest build is the one built last (`builtAt`), whatever order the results
come in. Released is decided by the result's optional
`examples: [{ phrase, passed, detail? }]`, which says how the built recipe
answered each phrase. A phrase the result leaves out counts as not passed, and a
spec agreed before recipes has no examples, so it can't be released until it is
revised. While a published build isn't released, the method's log says why.
Recording the same result again changes nothing.

From Building or Released the request can be revised, as from Agreed; once the
new version is agreed, it waits for a build of that. A Building request can be
withdrawn; a Released one can't. The page shows the latest build: the
repository, branch and pull request, the published version and its registry page
(`https://swamp-club.com/extensions/<extension>`), and how each example came
out. See [ADR-004](docs/adr/ADR-004-build-results.md) and
[ADR-005](docs/adr/ADR-005-start-building.md).

### Log requests from a program

`workflows/workflow-capture-log-request.yaml` is the workflow puddlerouter runs.
It needs a `capture` behavior with `defaultAs` set to the account that logs
requests, and uses `sourceRef` as the idempotency key:

```bash
swamp workflow run @puddleworks/capture-log-request --input title="…" \
  --input description="…" --input currentProcess="…" --input sourceRef=turn-3f9a \
  --input requester=olive@example.com \
  --input phrase="what needs counting this week" \
  --input candidateExtensions='["@example/stock"]'
```

`requester` is the email of the person who asked, who must be in the people
list. They are the outcome owner, so they submit, agree and export as
themselves, and the request records that the logging account logged it from that
`sourceRef` (the page shows it in the history). The logging account isn't a
participant. A requester who isn't in the people list is refused, and nothing is
logged. Without `requester` the logging account owns the request, as before. The
same `sourceRef` from the same logging account still gives back the same
request, whoever it was logged for.

`phrase` and `candidateExtensions` are optional; given, they start the draft
spec's recipe.

A request the logging account already owns can be handed to the person who
asked. Only the outcome owner can do it, so act as the logging account:

```bash
swamp behavior run capture transfer_ownership --input as=intake-bot@example.com \
  --input id=12 --input to=olive@example.com
```

The new owner takes over every outcome owner's step, the old one stays on as an
observer, and the history records the change. It works while the request is a
draft or open.

It replaces `@puddleworks/capture-client`, which called the Node app's API.

A tool often logs the same need more than once, and each time it is a new draft.
Close a repeat with `close_as_duplicate`, naming the request it repeats with
`of`. The outcome owner or any builder can, while the repeat is a draft or still
open, and the request it repeats must not be closed. The repeat moves to
Duplicate, and the page shows the other request as "asked N times", linked to
each repeat:

```bash
swamp behavior run capture close_as_duplicate --input id=14 --input of=9 \
  --input as=bea@example.com
```

### Have an agent review the spec

Once a specification is proposed it is frozen for agreement. An agent that never
saw the discussion makes a good second reader: it reads only the frozen spec and
says what is missing, vague or can't be checked. The
`@puddleworks/capture-review-spec` workflow runs one and puts what it found on
the request. It is optional, and Capture doesn't depend on any agent: the
repository brings its own agent behavior. `@mgreten/cli-agent` runs Claude Code,
Codex, OpenCode, Gemini CLI, Amp, Grok or pi, so each repository picks its
provider. The provider's CLI must be installed and signed in on the machine.

Set it up once:

```bash
swamp extension pull @mgreten/cli-agent
swamp behavior create @mgreten/cli-agent spec-reviewer \
  --global-arg defaultProvider=claude --global-arg defaultModel=sonnet
swamp behavior run capture add_person --input email=reviewer@example.com \
  --input name="Spec reviewer"
```

Then, for each request, invite the reviewer (the outcome owner or a builder can)
and run the workflow after the spec is proposed:

```bash
swamp behavior run capture invite --input id=12 \
  --input email=reviewer@example.com --input role=reviewer
swamp workflow run @puddleworks/capture-review-spec --input id=12 \
  --input reviewer=spec-reviewer --input reviewerAs=reviewer@example.com
```

The workflow writes the review prompt (`review_prompt`, as `review-prompt-<id>`
data), has the agent answer it with a verdict and findings in JSON, and records
them (`record_review`). Each finding becomes a question on the request, and the
verdict a decision:

| Verdict                        | What happens                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `ready` or `minor_revision`    | Stays up for agreement; agreeing waits until the findings' questions are resolved |
| `major_revision` or `not_safe` | Sent back for changes, so the spec can be rewritten and proposed again            |

Both methods refuse unless the request is ready for agreement and `as` is a
reviewer on it, and a review of a version that is no longer up for agreement is
refused. The review criteria follow the work-item lens of
[`@atalanta/sdlc-review-lenses`](https://github.com/Atalanta/swamp-sdlc-review-lenses)
(MIT), rewritten for outcome-spec fields.

### Develop

```bash
deno task check && deno task lint && deno task test
deno task build:web   # after changing web/, rebuild the bundled page
deno fmt --check
swamp extension fmt manifest.yaml --check
```

`extensions/models/_lib/web/page/` is the page: Preact components the server
renders to HTML. `web/src/` holds its shell, styles, icon and a small script
(opening "Show all", and reading the page again when the data changes), built by
`web/build.ts` into `extensions/models/_lib/web/assets.ts`. A test fails while
that file is older than its source. The domain rules are in
`extensions/models/_lib/domain/`, pure TypeScript with no I/O.

To try the extension from this checkout without publishing, in another swamp
repository: `swamp extension source add <path to this checkout>`.

### Move Capture to another repository

Capture's record is swamp data in one repository. To move it, export a
`capture-snapshot/v1` file there and import it in the new repository, where
`capture` is set up as above. The file holds everything: the people list with
their emails, and every request whatever its sharing, with its number, messages,
specification versions, history and idempotency keys. It is written readable by
you only and never over an existing file. Keep it out of git and delete it once
the move is checked.

```bash
# In the old repository
swamp behavior run capture export_snapshot --input path=capture-snapshot.json
# In the new one
swamp behavior run capture import --input path=/full/path/to/capture-snapshot.json
```

Each request keeps its number unless the new repository already has a request
with it; then it gets the next free one. Check `import-latest`: on an empty
repository `requestsNumbered` is 0 and `requestsAdded` equals `requests` in the
old repository's `export-latest`. A program that logs with the same `sourceRef`
afterwards gets back the same request, as long as it acts as the same person.

### Bring in data from the Node app

The retired Node app exported everything it held (people without passwords, and
requests with their idempotency keys and history) as one `capture-snapshot/v1`
file, with no request numbers. `import` brings such a file in, as many times as
needed: what is already there is skipped, and what is new is numbered after the
requests already here.

```bash
swamp behavior run capture import --input path=capture-snapshot.json
```
