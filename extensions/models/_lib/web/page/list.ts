// Every request, grouped by your next step, and the people list. Each group
// shows its first few requests; the rest roll down beneath them on "Show
// all", which the page's script opens.
import { Fragment, h } from "preact";
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

export function RequestList({ data }: {
  data: WebOverview;
}) {
  return h(
    Fragment,
    null,
    h("h1", null, "Requests"),
    data.requests.length === 0
      ? h(
        "p",
        { class: "empty" },
        "No requests yet. Raise one with",
        " ",
        h("code", null, "swamp behavior run capture create_request"),
        ".",
      )
      : GROUPS.map((group) => {
        const items = data.requests.filter((r) =>
          group.statuses.includes(r.status)
        );
        if (items.length === 0) {
          return null;
        }
        return h(Stage, { key: group.key, group: group, items: items });
      }),
    h(
      "section",
      { "aria-labelledby": "people-heading" },
      h("h2", { id: "people-heading" }, "People"),
      data.people.length === 0
        ? h("p", { class: "empty" }, "Nobody yet. Add someone with add_person.")
        : h(
          "ul",
          { class: "people" },
          data.people.map((p) =>
            h(
              "li",
              { key: p.email },
              h("span", { class: "person-name" }, p.name),
              h("span", { class: "card-meta" }, p.email),
              p.isBuilder &&
                h("span", { class: "badge badge-active" }, "Builder"),
            )
          ),
        ),
    ),
    h("p", { class: "card-meta read-at" }, "Read ", formatTime(data.readAt)),
  );
}

function Stage({ group, items }: {
  group: Group;
  items: WebSummary[];
}) {
  const { shown, rest } = splitStage(group, items);
  const id = `group-${group.key}`;
  const restId = `${id}-rest`;
  return h(
    "section",
    { "aria-labelledby": id },
    h("h2", { id: id }, group.heading),
    shown.map((r) => h(Card, { key: r.id, request: r })),
    rest.length > 0 &&
      h(
        Fragment,
        null,
        h(
          "div",
          { id: restId, class: "concertina" },
          h(
            "div",
            { class: "concertina-inner", inert: true },
            rest.map((r) => h(Card, { key: r.id, request: r })),
          ),
        ),
        h(
          "button",
          {
            type: "button",
            class: "link-button show-all",
            "aria-expanded": "false",
            "aria-controls": restId,
            "data-open-label": group.folded ? "Hide" : "Show fewer",
          },
          group.folded
            ? `Show ${items.length} closed`
            : `Show all ${items.length}`,
        ),
      ),
  );
}

/** Links to other requests, by number: "#4, #6". */
export function RequestLinks({ refs }: {
  refs: RequestRef[];
}) {
  return h(
    Fragment,
    null,
    refs.map((d, i) =>
      h(
        Fragment,
        null,
        i > 0 && ", ",
        h(
          "a",
          { key: d.id, href: `/requests/${encodeURIComponent(d.id)}` },
          d.number === null ? d.title : `#${d.number}`,
        ),
      )
    ),
  );
}

function Card({ request }: {
  request: WebSummary;
}) {
  return h(
    "div",
    { class: "card" },
    h(
      "div",
      { class: "card-title" },
      h(
        "a",
        { href: `/requests/${encodeURIComponent(request.id)}` },
        numbered(request),
      ),
      h(
        "div",
        { class: "card-meta" },
        request.outcomeOwner.name,
        " · updated ",
        formatTime(request.updatedAt),
        request.openQuestionCount > 0 &&
          ` · ${plural(request.openQuestionCount, "open question")}`,
        request.imported && " · imported",
        request.duplicates.length > 0 &&
          h(
            Fragment,
            null,
            ` · asked ${request.duplicates.length + 1} times: `,
            h(RequestLinks, { refs: request.duplicates }),
          ),
      ),
    ),
    h("span", { class: badgeClass(request.status) }, STATUS[request.status]),
  );
}
