// Every request, grouped by where it is, and the people list. Each stage shows
// its first few requests; the rest roll down beneath them on "Show all".
import { useEffect, useState } from "preact/hooks";
import type {
  RequestRef,
  WebOverview,
  WebSummary,
} from "../../extensions/models/_lib/capture/view_types.ts";
import * as api from "./api.ts";
import { Link } from "./nav.tsx";
import {
  badgeClass,
  formatTime,
  type Group,
  GROUPS,
  numbered,
  plural,
  splitStage,
  STATUS,
} from "./words.ts";

export function RequestList({ changes }: { changes: number }) {
  const [data, setData] = useState<WebOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Requests — Capture";
  }, []);

  useEffect(() => {
    api.overview().then((d) => {
      setData(d);
      setError(null);
    }, (e) => setError(String(e.message ?? e)));
  }, [changes]);

  if (error) return <p role="alert" class="flash-alert">{error}</p>;
  if (!data) return <p class="empty">Loading…</p>;

  return (
    <>
      <h1>Requests</h1>
      {data.requests.length === 0
        ? (
          <p class="empty">
            No requests yet. Raise one with{" "}
            <code>swamp behavior run capture create_request</code>.
          </p>
        )
        : GROUPS.map((group) => {
          const items = data.requests.filter((r) =>
            group.statuses.includes(r.status)
          );
          if (items.length === 0) return null;
          return <Stage key={group.key} group={group} items={items} />;
        })}
      <section aria-labelledby="people-heading">
        <h2 id="people-heading">People</h2>
        {data.people.length === 0
          ? <p class="empty">Nobody yet. Add someone with add_person.</p>
          : (
            <ul class="people">
              {data.people.map((p) => (
                <li key={p.email}>
                  <span class="person-name">{p.name}</span>
                  <span class="card-meta">{p.email}</span>
                  {p.isBuilder && (
                    <span class="badge badge-active">Builder</span>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>
      <p class="card-meta read-at">Read {formatTime(data.readAt)}</p>
    </>
  );
}

function Stage({ group, items }: { group: Group; items: WebSummary[] }) {
  const [open, setOpen] = useState(false);
  const { shown, rest } = splitStage(group, items);
  const id = `group-${group.key}`;
  const restId = `${id}-rest`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{group.heading}</h2>
      {shown.map((r) => <Card key={r.id} request={r} />)}
      {rest.length > 0 && (
        <>
          <div id={restId} class={open ? "concertina open" : "concertina"}>
            <div class="concertina-inner" inert={!open}>
              {rest.map((r) => <Card key={r.id} request={r} />)}
            </div>
          </div>
          <button
            type="button"
            class="link-button show-all"
            aria-expanded={open}
            aria-controls={restId}
            onClick={() => setOpen(!open)}
          >
            {open
              ? (group.folded ? "Hide" : "Show fewer")
              : group.folded
              ? `Show ${items.length} closed`
              : `Show all ${items.length}`}
          </button>
        </>
      )}
    </section>
  );
}

/** Links to other requests, by number: "#4, #6". */
export function RequestLinks({ refs }: { refs: RequestRef[] }) {
  return (
    <>
      {refs.map((d, i) => (
        <>
          {i > 0 && ", "}
          <Link key={d.id} to={`/requests/${encodeURIComponent(d.id)}`}>
            {d.number === null ? d.title : `#${d.number}`}
          </Link>
        </>
      ))}
    </>
  );
}

function Card({ request }: { request: WebSummary }) {
  return (
    <div class="card">
      <div class="card-title">
        <Link to={`/requests/${encodeURIComponent(request.id)}`}>
          {numbered(request)}
        </Link>
        <div class="card-meta">
          {request.outcomeOwner.name} · updated {formatTime(request.updatedAt)}
          {request.openQuestionCount > 0 &&
            ` · ${plural(request.openQuestionCount, "open question")}`}
          {request.imported && " · imported"}
          {request.duplicates.length > 0 && (
            <>
              {` · asked ${request.duplicates.length + 1} times: `}
              <RequestLinks refs={request.duplicates} />
            </>
          )}
        </div>
      </div>
      <span class={badgeClass(request.status)}>{STATUS[request.status]}</span>
    </div>
  );
}
