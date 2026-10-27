# puddleworks-capture

Captures requirements: takes a request, discusses it, agrees the outcome and
exports a spec. It stops there.

One of three separate Puddleworks applications: Capture, Factory and
Distribution. Each runs alone and can be swapped out. They share no code, only
versioned file contracts. See [ADR-001](docs/adr/ADR-001-three-separate-apps.md)
and the epic puddle-works/puddleworks#207.

| Takes in  | Puts out                  |
| --------- | ------------------------- |
| a request | an `outcome-spec/v1` file |

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

### Who acts

Every method acts as one person in the people list: `--input as=<email>`, or the
behavior's `defaultAs` when `as` is left out. Their role on the request decides
what they may do, as before: the outcome owner submits, agrees, withdraws and
exports; builders join open requests and write the specification; reviewers ask
questions and ask for changes; observers read. Agreeing waits until every
question is resolved. There is no sign-in, so anyone who can run swamp in the
repository can act as anyone on the list.

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

The same `idempotencyKey` from the same person always gives back the same
request. Reads (`get_request`, `list_requests`) write what they found as `view`
and `requestList` data; `export_outcome_spec` writes `outcomeSpec` or
`outcomeSpecMarkdown`.

### Log requests from a program

`workflows/workflow-capture-log-request.yaml` is the workflow puddlerouter runs.
It needs a `capture` behavior with `defaultAs` set, and uses `sourceRef` as the
idempotency key:

```bash
swamp workflow run @puddleworks/capture-log-request --input title="…" \
  --input description="…" --input currentProcess="…" --input sourceRef=turn-3f9a
```

It replaces `@puddleworks/capture-client`, which called the Node app's API.

### Develop

```bash
deno task check && deno task lint && deno task test
deno task build:web   # after changing web/, rebuild the bundled page
deno fmt --check
swamp extension fmt manifest.yaml --check
```

`web/src/` is the page: Preact, built by `web/build.ts` into
`extensions/models/_lib/web/assets.ts`. A test fails while that file is older
than its source. The domain rules are in `extensions/models/_lib/domain/`, pure
TypeScript with no I/O.

To try the extension from this checkout without publishing, in another swamp
repository: `swamp extension source add <path to this checkout>`.

### Bring in data from the Node app

The retired Node app exported everything it held (people without passwords, and
requests with their idempotency keys and history) as one `capture-snapshot/v1`
file. `import` brings such a file in, as many times as needed: what is already
there is skipped, and what is new is numbered after the requests already here.

```bash
swamp behavior run capture import --input path=capture-snapshot.json
```
