// The words the page uses for Capture's codes, the list's groups and the
// history timeline, in one place.
import type { ExportFormat, Recipe, Role } from "../../domain/model.ts";
import type { RequestStatus, WebRequest } from "../../capture/view_types.ts";

export const STATUS: Record<RequestStatus, string> = {
  draft: "Draft",
  discussing: "Being discussed",
  ready_for_agreement: "Ready for agreement",
  agreed: "Agreed",
  building: "Building",
  released: "Released",
  withdrawn: "Withdrawn",
  declined: "Declined",
  duplicate: "Duplicate",
};

/** What the Build section says while no build stands for the agreed version. */
export function noBuildYet(status: RequestStatus): string {
  return status === "building"
    ? "Work has started. No build result has been recorded yet."
    : "Nothing built from the version agreed now yet.";
}

/** How a group of the list is ordered. */
type Order = "oldest" | "newest" | "highestNumber";

export interface Group {
  key: string;
  heading: string;
  statuses: RequestStatus[];
  order: Order;
  /** Folded away behind "Show" until opened. */
  folded?: boolean;
}

/** The list's groups, named after your next step, in the order you take them. */
export const GROUPS: Group[] = [
  { key: "inbox", heading: "Inbox", statuses: ["draft"], order: "oldest" },
  {
    key: "in-progress",
    heading: "In progress",
    statuses: ["discussing"],
    order: "highestNumber",
  },
  {
    key: "to-review",
    heading: "To review",
    statuses: ["ready_for_agreement"],
    order: "oldest",
  },
  {
    key: "ready-to-build",
    heading: "Ready to build",
    statuses: ["agreed"],
    order: "oldest",
  },
  {
    key: "building",
    heading: "Building",
    statuses: ["building"],
    order: "newest",
  },
  {
    key: "released",
    heading: "Released",
    statuses: ["released"],
    order: "newest",
  },
  {
    key: "closed",
    heading: "Closed",
    statuses: ["withdrawn", "declined", "duplicate"],
    order: "newest",
    folded: true,
  },
];

/** How many requests each group of the list shows before "Show all". */
export const SHOWN_PER_STAGE = 5;

type Sortable = { number: number | null; updatedAt: string };

const lastUpdatedFirst = (a: Sortable, b: Sortable) =>
  b.updatedAt.localeCompare(a.updatedAt);

/** Highest number first, so a request keeps its place when it changes; unnumbered ones last. */
const highestNumberFirst = (a: Sortable, b: Sortable) =>
  a.number === b.number
    ? lastUpdatedFirst(a, b)
    : (b.number ?? -Infinity) - (a.number ?? -Infinity);

const ORDER: Record<Order, (a: Sortable, b: Sortable) => number> = {
  oldest: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
  newest: lastUpdatedFirst,
  highestNumber: highestNumberFirst,
};

/**
 * A group's requests in its order, split into the first few and the rest. A
 * folded group shows none until opened.
 */
export function splitStage<T extends Sortable>(
  group: Group,
  items: T[],
): { shown: T[]; rest: T[] } {
  const sorted = [...items].sort(ORDER[group.order]);
  const shown = group.folded ? 0 : SHOWN_PER_STAGE;
  return { shown: sorted.slice(0, shown), rest: sorted.slice(shown) };
}

const BADGE: Record<RequestStatus, string> = {
  draft: "draft",
  discussing: "active",
  ready_for_agreement: "review",
  agreed: "delivered",
  building: "active",
  released: "delivered",
  withdrawn: "closed",
  declined: "closed",
  duplicate: "closed",
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
  build: "Building",
  release: "Released",
  import: "Imported",
  editDetails: "Details changed",
  closeAsDuplicate: "Closed as a duplicate",
};

/** Every state change or change to the details, who made it and when, after the request was raised. */
export function historyEntries(request: WebRequest): HistoryEntry[] {
  const raised: HistoryEntry = {
    label: "Raised",
    by: request.outcomeOwner.name,
    at: request.createdAt,
    note: null,
  };
  const exportedAs = (e: WebRequest["exports"][number]) =>
    `Exported as ${FORMAT[e.format]} (version ${e.specVersion})`;
  const changes = request.transitions.map((t) => {
    let label = ACTION[t.action] ?? t.action;
    if (t.action === "agree") {
      const agreement = request.agreements.find((a) => a.agreedAt === t.at);
      label = agreement
        ? `Agreed to version ${agreement.specVersion}`
        : "Agreed";
    }
    if (t.action === "build" || t.action === "release") {
      // Recording the build result made the change, at the same moment.
      const b = request.buildResults.findLast((b) => b.recordedAt === t.at);
      if (b && t.action === "build") {
        label = `Building from ${b.result.buildRef}`;
      }
      if (b?.result.published && t.action === "release") {
        label = `Released ${b.result.extension} ${b.result.published.version}`;
      }
    }
    if (t.action === "closeAsDuplicate" && request.duplicateOf) {
      label = `Closed as a duplicate of ${numbered(request.duplicateOf)}`;
    }
    if (t.action === "export") {
      const exported = request.exports.find((e) => e.exportedAt === t.at);
      label = exported ? exportedAs(exported) : "Exported";
    }
    return { label, by: t.byName, at: t.at, note: t.note };
  });
  // An export once moved the status, so older ones are transitions too.
  const exports = request.exports
    .filter((e) =>
      !request.transitions.some((t) =>
        t.action === "export" && t.at === e.exportedAt
      )
    )
    .map((e) => ({
      label: exportedAs(e),
      by: e.exportedByName,
      at: e.exportedAt,
      note: null,
    }));
  return [
    raised,
    ...[...changes, ...exports].sort((a, b) => a.at.localeCompare(b.at)),
  ];
}
