// The page's pure parts: which view a path shows, and the history timeline.
import {
  describe,
  expect,
  it,
} from "../../extensions/models/_lib/domain/test_bdd.ts";
import { agreedRequest } from "../../extensions/models/_lib/domain/test_fixtures.ts";
import { toWebRequest } from "../../extensions/models/_lib/capture/views.ts";
import {
  badgeClass,
  historyEntries,
  numbered,
  pieceLabels,
  plural,
  RECENT_PER_STAGE,
  routeOf,
  splitRecent,
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
});

describe("words", () => {
  it("badges states and counts things", () => {
    expect(badgeClass("ready_for_agreement")).toBe("badge badge-review");
    expect(plural(1, "open question")).toBe("1 open question");
    expect(plural(2, "open question")).toBe("2 open questions");
  });
});

describe("splitRecent", () => {
  const at = (day: number) => ({
    id: `r-${day}`,
    updatedAt: `2026-10-${String(day).padStart(2, "0")}T09:00:00.000Z`,
  });

  it("shows the five most recently updated and keeps the rest for show all", () => {
    expect(RECENT_PER_STAGE).toBe(5);
    const group = [3, 9, 1, 7, 5, 8, 2].map(at);
    const { recent, rest } = splitRecent(group);
    expect(recent.map((r) => r.id)).toEqual([
      "r-9",
      "r-8",
      "r-7",
      "r-5",
      "r-3",
    ]);
    expect(rest.map((r) => r.id)).toEqual(["r-2", "r-1"]);
  });

  it("keeps nothing back when a stage has five or fewer", () => {
    const { recent, rest } = splitRecent([1, 2, 3, 4, 5].map(at));
    expect(recent.length).toBe(5);
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
