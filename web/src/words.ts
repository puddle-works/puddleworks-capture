// The words the page uses for Capture's codes, which path shows which view,
// and the history timeline, in one place. Nothing here touches the DOM, so
// words_test runs it under deno test.
import type {
  ExportFormat,
  Recipe,
  Role,
} from "../../extensions/models/_lib/domain/model.ts";
import type {
  RequestStatus,
  WebRequest,
} from "../../extensions/models/_lib/capture/view_types.ts";

export const STATUS: Record<RequestStatus, string> = {
  draft: "Draft",
  discussing: "Being discussed",
  ready_for_agreement: "Ready for agreement",
  agreed: "Agreed",
  exported: "Exported",
  withdrawn: "Withdrawn",
  declined: "Declined",
};

/** Headings for the request list, in the order a request moves through them. */
export const STATUS_GROUPS: [RequestStatus, string][] = [
  ["draft", "Drafts"],
  ["discussing", "Being discussed"],
  ["ready_for_agreement", "Ready for agreement"],
  ["agreed", "Agreed"],
  ["exported", "Exported"],
  ["withdrawn", "Withdrawn"],
  ["declined", "Declined"],
];

/** How many requests each stage of the list shows before "Show all". */
export const RECENT_PER_STAGE = 5;

/** A stage's most recently updated requests, newest first, and the rest. */
export function splitRecent<T extends { updatedAt: string }>(
  group: T[],
): { recent: T[]; rest: T[] } {
  const newest = [...group].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  return {
    recent: newest.slice(0, RECENT_PER_STAGE),
    rest: newest.slice(RECENT_PER_STAGE),
  };
}

const BADGE: Record<RequestStatus, string> = {
  draft: "draft",
  discussing: "active",
  ready_for_agreement: "review",
  agreed: "delivered",
  exported: "delivered",
  withdrawn: "closed",
  declined: "closed",
};

/** A request's title with its number before it, as people refer to it: "#12 Stock counts". */
export function numbered(
  request: { number: number | null; title: string },
): string {
  return request.number === null
    ? request.title
    : `#${request.number} ${request.title}`;
}

export function badgeClass(status: RequestStatus): string {
  return `badge badge-${BADGE[status]}`;
}

export const ROLE: Record<Role, string> = {
  outcome_owner: "Outcome owner",
  builder: "Builder",
  observer: "Observer",
  reviewer: "Reviewer",
};

export const FORMAT: Record<ExportFormat, string> = {
  "outcome-spec/v1+json": "Outcome spec (JSON)",
  markdown: "Markdown",
};

const when = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "22 Oct 2026, 3:04 pm" */
export function formatTime(iso: string): string {
  return when.format(new Date(iso));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const SHAPE: Record<Recipe["pieces"][number]["shape"], string> = {
  int: "a number",
  repo: "a repo",
  word: "a word",
};

/** The pieces a recipe takes from the phrase, as "weeks (a number)". */
export function pieceLabels(pieces: Recipe["pieces"]): string[] {
  return pieces.map((p) => `${p.name} (${SHAPE[p.shape]})`);
}

/** "ready_for_agreement" → "ready for agreement" */
export const words = (code: string) => code.replaceAll("_", " ");

export type Route = { page: "list" } | { page: "request"; id: string } | {
  page: "missing";
};

/** The view a path shows: the server serves the page on / and /requests/<id>. */
export function routeOf(pathname: string): Route {
  let parts: string[];
  try {
    parts = pathname.split("/").filter((p) => p !== "").map(decodeURIComponent);
  } catch {
    return { page: "missing" };
  }
  if (parts.length === 0) return { page: "list" };
  if (parts.length === 2 && parts[0] === "requests") {
    return { page: "request", id: parts[1] };
  }
  return { page: "missing" };
}

export interface HistoryEntry {
  label: string;
  by: string;
  at: string;
  note: string | null;
}

const ACTION: Record<string, string> = {
  submit: "Submitted for discussion",
  propose: "Proposed for agreement",
  requestChanges: "Sent back for changes",
  revise: "Reopened to revise",
  withdraw: "Request withdrawn",
  decline: "Request declined",
  import: "Imported",
};

/** Every state change, who made it and when, after the request was raised. */
export function historyEntries(request: WebRequest): HistoryEntry[] {
  const raised: HistoryEntry = {
    label: "Raised",
    by: request.outcomeOwner.name,
    at: request.createdAt,
    note: null,
  };
  return [
    raised,
    ...request.transitions.map((t) => {
      let label = ACTION[t.action] ?? t.action;
      if (t.action === "agree") {
        const agreement = request.agreements.find((a) => a.agreedAt === t.at);
        label = agreement
          ? `Agreed to version ${agreement.specVersion}`
          : "Agreed";
      }
      if (t.action === "export") {
        const exported = request.exports.find((e) => e.exportedAt === t.at);
        label = exported
          ? `Exported as ${
            FORMAT[exported.format]
          } (version ${exported.specVersion})`
          : "Exported";
      }
      return { label, by: t.byName, at: t.at, note: t.note };
    }),
  ];
}
