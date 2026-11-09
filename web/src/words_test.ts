// The page's pure parts: which view a path shows, and the history timeline.
import {
  describe,
  expect,
  it,
} from "../../extensions/models/_lib/domain/test_bdd.ts";
import {
  agreedRequest,
  builder,
  buildResult,
  discussingRequest,
  owner,
  releasingResult,
  T2,
} from "../../extensions/models/_lib/domain/test_fixtures.ts";
import {
  editDetails,
  recordBuildResult,
  recordExport,
} from "../../extensions/models/_lib/domain/index.ts";
import { toWebRequest } from "../../extensions/models/_lib/capture/views.ts";
import {
  badgeClass,
  historyEntries,
  numbered,
  pieceLabels,
  plural,
  routeOf,
  SHOWN_PER_STAGE,
  splitStage,
  STATUS_GROUPS,
} from "./words.ts";

describe("routeOf", () => {
  it("shows the list at / and a request at /requests/<id>", () => {
    expect(routeOf("/")).toEqual({ page: "list" });
    expect(routeOf("/requests/r-1")).toEqual({ page: "request", id: "r-1" });
    expect(routeOf("/requests/a%20b")).toEqual({ page: "request", id: "a b" });
  });

  it("shows nothing for any other path", () => {
    expect(routeOf("/requests/")).toEqual({ page: "missing" });
    expect(routeOf("/elsewhere")).toEqual({ page: "missing" });
    expect(routeOf("/requests/%E0")).toEqual({ page: "missing" });
  });
});

describe("numbered", () => {
  it("puts the request's number before its title, when it has one", () => {
    expect(numbered({ number: 12, title: "Stock counts" })).toBe(
      "#12 Stock counts",
    );
    expect(numbered({ number: null, title: "Stock counts" })).toBe(
      "Stock counts",
    );
  });
});

describe("historyEntries", () => {
  it("starts with raising the request and names who made each change", () => {
    const view = toWebRequest({
      request: agreedRequest(),
      version: 4,
      idempotencyKeys: [],
      before: null,
      legacy: null,
      number: 1,
    });
    const entries = historyEntries(view);
    expect(entries[0]).toEqual({
      label: "Raised",
      by: "Olive Owner",
      at: view.createdAt,
      note: null,
    });
    expect(entries.map((e) => e.label)).toContain("Submitted for discussion");
    expect(entries.map((e) => e.label)).toContain("Agreed to version 1");
    expect(entries.length).toBe(view.transitions.length + 1);
  });

  it("words the change an import made", () => {
    const request = agreedRequest();
    request.transitions = [{
      from: "draft",
      to: "agreed",
      action: "import",
      by: request.outcomeOwnerId,
      at: request.updatedAt,
      note: 'Imported from Puddleworks request "x" (was retrospective).',
    }];
    const view = toWebRequest({
      request,
      version: 1,
      idempotencyKeys: [],
      before: null,
      legacy: null,
      number: 1,
    });
    expect(historyEntries(view)[1].label).toBe("Imported");
  });

  it("says when the details changed after submitting, and how", () => {
    const request = editDetails(discussingRequest(), owner, {
      title: "Friday stock count",
    }, T2);
    const view = toWebRequest({
      request,
      version: 2,
      idempotencyKeys: [],
      before: null,
      legacy: null,
      number: 1,
    });
    expect(historyEntries(view).at(-1)).toEqual({
      label: "Details changed",
      by: "Olive Owner",
      at: T2,
      note: 'Title was "Stock counts".',
    });
  });

  it("shows each export at its time, as exports no longer change the status", () => {
    const request = recordExport(agreedRequest(), owner, "markdown", T2);
    const view = toWebRequest({
      request,
      version: 5,
      idempotencyKeys: [],
      before: null,
      legacy: null,
      number: 1,
    });
    const entries = historyEntries(view);
    expect(entries).toHaveLength(view.transitions.length + 2);
    expect(entries[entries.length - 1]).toEqual({
      label: "Exported as Markdown (version 1)",
      by: "Olive Owner",
      at: T2,
      note: null,
    });
  });

  it("shows an older export, saved as a transition, once", () => {
    const request = agreedRequest();
    request.exports = [{
      specVersion: 1,
      format: "markdown",
      exportedBy: request.outcomeOwnerId,
      exportedAt: T2,
    }];
    request.transitions = [...request.transitions, {
      from: "agreed",
      to: "agreed",
      action: "export",
      by: request.outcomeOwnerId,
      at: T2,
      note: null,
    }];
    const view = toWebRequest({
      request,
      version: 5,
      idempotencyKeys: [],
      before: null,
      legacy: null,
      number: 1,
    });
    const labels = historyEntries(view).map((e) => e.label);
    expect(labels.filter((l) => l.startsWith("Exported"))).toEqual([
      "Exported as Markdown (version 1)",
    ]);
  });
});

describe("history of a build", () => {
  it("says when building started and what was released", () => {
    let request = recordBuildResult(
      agreedRequest(),
      builder,
      buildResult(),
      "2026-10-23T13:00:00.000Z",
    );
    request = recordBuildResult(
      request,
      builder,
      releasingResult(),
      "2026-10-23T14:00:00.000Z",
    );
    const view = toWebRequest({
      request,
      version: 6,
      idempotencyKeys: [],
      before: null,
      legacy: null,
      number: 1,
    });
    expect(historyEntries(view).slice(-2)).toEqual([
      {
        label: "Building from draft/stock-counts",
        by: "Bea Builder",
        at: "2026-10-23T13:00:00.000Z",
        note: null,
      },
      {
        label: "Released @example/stock-counts 2026.10.23.1",
        by: "Bea Builder",
        at: "2026-10-23T14:00:00.000Z",
        note: null,
      },
    ]);
  });

  it("lists building and released after agreed, with their own badges", () => {
    expect(STATUS_GROUPS.map(([s]) => s)).toEqual([
      "draft",
      "discussing",
      "ready_for_agreement",
      "agreed",
      "building",
      "released",
      "withdrawn",
      "declined",
    ]);
    expect(badgeClass("building")).toBe("badge badge-active");
    expect(badgeClass("released")).toBe("badge badge-delivered");
  });
});

describe("words", () => {
  it("badges states and counts things", () => {
    expect(badgeClass("ready_for_agreement")).toBe("badge badge-review");
    expect(plural(1, "open question")).toBe("1 open question");
    expect(plural(2, "open question")).toBe("2 open questions");
  });
});

describe("splitStage", () => {
  const req = (n: number | null, day: number) => ({
    id: n === null ? `old-${day}` : `#${n}`,
    number: n,
    updatedAt: `2026-10-${String(day).padStart(2, "0")}T09:00:00.000Z`,
  });
  const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

  it("shows five in other stages, last updated first, and keeps the rest for show all", () => {
    expect(SHOWN_PER_STAGE).toBe(5);
    const group = [3, 9, 1, 7, 5, 8, 2].map((day) => req(10 - day, day));
    const { shown, rest } = splitStage("agreed", group);
    expect(ids(shown)).toEqual(["#1", "#2", "#3", "#5", "#7"]);
    expect(ids(rest)).toEqual(["#8", "#9"]);
  });

  it("puts being discussed in number order, highest first, whenever each was updated", () => {
    // #2 was updated last and #9 longest ago; neither moves.
    const group = [[4, 3], [9, 1], [2, 28], [7, 5], [5, 2], [8, 4], [3, 6]]
      .map(([n, day]) => req(n, day));
    const { shown, rest } = splitStage("discussing", group);
    expect(ids(shown)).toEqual(["#9", "#8", "#7", "#5", "#4"]);
    expect(ids(rest)).toEqual(["#3", "#2"]);
  });

  it("puts being discussed requests without a number last, last updated first", () => {
    const group = [req(null, 20), req(1, 2), req(null, 25), req(3, 1)];
    const { shown } = splitStage("discussing", group);
    expect(ids(shown)).toEqual(["#3", "#1", "old-25", "old-20"]);
  });

  it("keeps nothing back when a stage has five or fewer", () => {
    const { shown, rest } = splitStage(
      "draft",
      [1, 2, 3, 4, 5].map((n) => req(n, n)),
    );
    expect(shown.length).toBe(5);
    expect(rest).toEqual([]);
  });
});

describe("pieceLabels", () => {
  it("names each piece taken from the phrase, and its shape", () => {
    expect(pieceLabels([{ name: "weeks", shape: "int" }, {
      name: "project",
      shape: "repo",
    }])).toEqual(["weeks (a number)", "project (a repo)"]);
    expect(pieceLabels([{ name: "label", shape: "word" }])).toEqual([
      "label (a word)",
    ]);
  });
});
