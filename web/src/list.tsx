// Every request, grouped by where it is, and the people list.
import { useEffect, useState } from "preact/hooks";
import type {
  WebOverview,
  WebSummary,
} from "../../extensions/models/_lib/capture/view_types.ts";
import * as api from "./api.ts";
import { Link } from "./nav.tsx";
import {
  badgeClass,
  formatTime,
  numbered,
  plural,
  STATUS,
  STATUS_GROUPS,
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
        : STATUS_GROUPS.map(([status, heading]) => {
          const group = data.requests.filter((r) => r.status === status);
          if (group.length === 0) return null;
          const id = `group-${status}`;
          return (
            <section key={status} aria-labelledby={id}>
              <h2 id={id}>{heading}</h2>
              {group.map((r) => <Card key={r.id} request={r} />)}
            </section>
          );
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
        </div>
      </div>
      <span class={badgeClass(request.status)}>{STATUS[request.status]}</span>
    </div>
  );
}
