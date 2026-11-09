// Every request, grouped by your next step, and the people list. Each group
// shows its first few requests; the rest roll down beneath them on "Show
// all", which the page's script opens.
import type {
  RequestRef,
  WebOverview,
  WebSummary,
} from "../../capture/view_types.ts";
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

export function RequestList({ data }: { data: WebOverview }) {
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
  const { shown, rest } = splitStage(group, items);
  const id = `group-${group.key}`;
  const restId = `${id}-rest`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{group.heading}</h2>
      {shown.map((r) => <Card key={r.id} request={r} />)}
      {rest.length > 0 && (
        <>
          <div id={restId} class="concertina">
            <div class="concertina-inner" inert>
              {rest.map((r) => <Card key={r.id} request={r} />)}
            </div>
          </div>
          <button
            type="button"
            class="link-button show-all"
            aria-expanded="false"
            aria-controls={restId}
            data-open-label={group.folded ? "Hide" : "Show fewer"}
          >
            {group.folded
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
          <a key={d.id} href={`/requests/${encodeURIComponent(d.id)}`}>
            {d.number === null ? d.title : `#${d.number}`}
          </a>
        </>
      ))}
    </>
  );
}

function Card({ request }: { request: WebSummary }) {
  return (
    <div class="card">
      <div class="card-title">
        <a href={`/requests/${encodeURIComponent(request.id)}`}>
          {numbered(request)}
        </a>
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
