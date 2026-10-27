// One request with everything on it: details, people, discussion, the
// specification and its versions, agreements, exports and history.
import { useEffect, useState } from "preact/hooks";
import type { Message } from "../../extensions/models/_lib/domain/model.ts";
import type {
  OldHistory,
  WebRequest,
} from "../../extensions/models/_lib/capture/view_types.ts";
import * as api from "./api.ts";
import { Link } from "./nav.tsx";
import {
  badgeClass,
  FORMAT,
  formatTime,
  historyEntries,
  numbered,
  plural,
  ROLE,
  STATUS,
  words,
} from "./words.ts";

type Spec = WebRequest["specifications"][number];

export function RequestPage({ id, changes }: { id: string; changes: number }) {
  const [request, setRequest] = useState<WebRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.request(id).then(
      (r) => {
        setRequest(r);
        setError(null);
      },
      (e) =>
        setError(
          e instanceof api.NotFound
            ? "There is no such request."
            : String(e.message ?? e),
        ),
    );
  }, [id, changes]);

  useEffect(() => {
    document.title = `${request ? numbered(request) : "Request"} — Capture`;
  }, [request?.number, request?.title]);

  return (
    <>
      <Link class="back-link" to="/">All requests</Link>
      {error && <p role="alert" class="flash-alert">{error}</p>}
      {!error && !request && <p class="empty">Loading…</p>}
      {!error && request && <Request request={request} />}
    </>
  );
}

function Request({ request: r }: { request: WebRequest }) {
  return (
    <>
      <div class="show-header">
        <h1>{numbered(r)}</h1>
        <div class="show-meta">
          <span class={badgeClass(r.status)}>{STATUS[r.status]}</span>
          <span>
            Raised by {r.outcomeOwner.name} · {formatTime(r.createdAt)}
          </span>
          <span>Updated {formatTime(r.updatedAt)}</span>
          {r.openQuestionCount > 0 && (
            <span>{plural(r.openQuestionCount, "open question")}</span>
          )}
        </div>
        {r.closedReason && <p class="closed-reason">{r.closedReason}</p>}
        <p class="card-meta request-id">
          <code>{r.id}</code>
        </p>
      </div>
      <section aria-labelledby="details-heading">
        <h2 id="details-heading">Details</h2>
        <h3>What they asked for</h3>
        <Text value={r.initialDescription} />
        <h3>How it's done today</h3>
        <Text value={r.currentProcess} />
      </section>
      <People request={r} />
      <Discussion request={r} />
      <Specifications request={r} />
      <History request={r} />
      {r.before && <Before before={r.before} />}
    </>
  );
}

function Text({ value }: { value: string }) {
  return value.trim()
    ? <p class="prose">{value}</p>
    : <p class="empty">Not written.</p>;
}

function People({ request }: { request: WebRequest }) {
  return (
    <section aria-labelledby="people-heading">
      <h2 id="people-heading">People</h2>
      <ul class="people">
        {request.participants.map((p) => (
          <li key={p.userId}>
            <span class="person-name">{p.name}</span>
            <span class="card-meta">{p.email}</span>
            <span class="badge badge-draft">{ROLE[p.role]}</span>
            <span class="card-meta">joined {formatTime(p.joinedAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const KIND: Record<Message["kind"], string> = {
  comment: "Comment",
  question: "Question",
  decision: "Decision",
};

function Discussion({ request }: { request: WebRequest }) {
  const { messages } = request;
  return (
    <section aria-labelledby="discussion-heading">
      <h2 id="discussion-heading">Discussion</h2>
      {messages.length === 0
        ? <p class="empty">Nothing said yet.</p>
        : (
          <ol class="messages">
            {messages.map((m) => {
              const open = m.kind === "question" && !m.resolvedAt;
              const answer = m.resolutionMessageId
                ? messages.find((x) => x.id === m.resolutionMessageId)
                : undefined;
              return (
                <li
                  key={m.id}
                  id={`message-${m.id}`}
                  class={`message message-${open ? "open" : m.kind}`}
                >
                  <div class="message-meta">
                    <strong>{m.authorName}</strong>
                    <span>{KIND[m.kind]}</span>
                    <span>{formatTime(m.createdAt)}</span>
                    {open && <span class="badge">Open</span>}
                    {m.resolvedAt && (
                      <span class="badge badge-delivered">
                        Resolved {formatTime(m.resolvedAt)}
                      </span>
                    )}
                  </div>
                  <p class="prose">{m.body}</p>
                  {answer && (
                    <p class="card-meta">
                      Answered by {answer.authorName}: “{excerpt(answer.body)}”
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
    </section>
  );
}

const excerpt = (text: string) =>
  text.length > 120 ? `${text.slice(0, 117)}…` : text;

function Specifications({ request }: { request: WebRequest }) {
  const versions = request.specifications;
  const latest = versions.at(-1);
  const [shown, setShown] = useState<number | null>(null);
  const older = shown === null
    ? undefined
    : versions.find((v) => v.version === shown);
  return (
    <section aria-labelledby="spec-heading">
      <h2 id="spec-heading">Specification</h2>
      {latest
        ? <Version spec={latest} />
        : <p class="empty">No specification yet.</p>}
      {request.agreements.length > 0 && (
        <>
          <h3>Agreements</h3>
          <ul class="agreements">
            {request.agreements.map((a) => (
              <li key={`${a.specVersion}-${a.agreedAt}`}>
                Version {a.specVersion} agreed by {a.agreedBy.name} ·{" "}
                {formatTime(a.agreedAt)}{" "}
                <code title="SHA-256 of the agreed content">
                  {a.specHash.slice(0, 12)}
                </code>
              </li>
            ))}
          </ul>
        </>
      )}
      {request.exports.length > 0 && (
        <>
          <h3>Exports</h3>
          <ul class="agreements">
            {request.exports.map((e) => (
              <li key={`${e.format}-${e.exportedAt}`}>
                {FORMAT[e.format]} of version {e.specVersion} by{" "}
                {e.exportedByName} · {formatTime(e.exportedAt)}
              </li>
            ))}
          </ul>
        </>
      )}
      {versions.length > 1 && (
        <>
          <h3>Earlier versions</h3>
          <ul aria-label="Earlier versions" class="versions">
            {versions.slice(0, -1).reverse().map((v) => (
              <li key={v.version}>
                <button
                  type="button"
                  class="link-button"
                  aria-pressed={shown === v.version}
                  onClick={() =>
                    setShown(shown === v.version ? null : v.version)}
                >
                  Version {v.version} · {words(v.status)} ·{" "}
                  {formatTime(v.updatedAt)}
                </button>
              </li>
            ))}
          </ul>
          {older && (
            <div class="older-version">
              <Version spec={older} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Version({ spec }: { spec: Spec }) {
  const { content } = spec;
  return (
    <div class="spec">
      <p class="spec-version">Version {spec.version} · {words(spec.status)}</p>
      <p class="card-meta">
        Started by {spec.createdByName} · last saved{" "}
        {formatTime(spec.updatedAt)}
      </p>
      {spec.status === "draft" && spec.problems.length > 0 && (
        <div class="problems">
          <p>Before it can be proposed:</p>
          <ul>{spec.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <h3>Problem statement</h3>
      <Text value={content.problemStatement} />
      <h3>Desired outcome</h3>
      <Text value={content.desiredOutcome} />
      <List title="In scope" items={content.scope.in} />
      <List title="Out of scope" items={content.scope.out} />
      <List title="Constraints" items={content.constraints} />
      <List title="Assumptions" items={content.assumptions} />
      <h3>Acceptance criteria</h3>
      {content.acceptanceCriteria.length === 0
        ? <p class="empty">None yet.</p>
        : (
          <dl class="criteria">
            {content.acceptanceCriteria.map((c) => (
              <div key={c.id}>
                <dt>{c.id}</dt>
                <dd>{c.text}</dd>
              </div>
            ))}
          </dl>
        )}
      {spec.basedOnMessageIds.length > 0 && (
        <p class="card-meta">
          Draws on {plural(spec.basedOnMessageIds.length, "decision")}{" "}
          from the discussion.
        </p>
      )}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <h3>{title}</h3>
      {items.length === 0
        ? <p class="empty">None.</p>
        : <ul>{items.map((i, n) => <li key={n}>{i}</li>)}</ul>}
    </>
  );
}

function History({ request }: { request: WebRequest }) {
  const list = historyEntries(request);
  return (
    <section aria-labelledby="history-heading">
      <h2 id="history-heading">History</h2>
      <ol class="timeline">
        {list.map((e, n) => (
          <li key={n} class={n === list.length - 1 ? "current" : undefined}>
            <div class="tl-label">{e.label}</div>
            <div class="tl-meta">{e.by} · {formatTime(e.at)}</div>
            {e.note && <div class="tl-note">{e.note}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Before({ before }: { before: OldHistory }) {
  return (
    <section aria-labelledby="before-heading">
      <h2 id="before-heading">Before Capture</h2>
      <p>
        Imported from Puddleworks, where it was <code>{before.name}</code>, last
        {" "}
        {words(before.state)}.
      </p>
      {before.transitions.length > 0 && (
        <ol class="timeline">
          {before.transitions.map((t, n) => (
            <li key={n}>
              <div class="tl-label">
                {t.from ? `${words(t.from)} → ${words(t.to)}` : words(t.to)}
              </div>
              <div class="tl-meta">{formatTime(t.at)}</div>
              {t.note && <div class="tl-note">{t.note}</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
