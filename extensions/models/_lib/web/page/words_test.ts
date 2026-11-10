// The page's words: the list's groups and the history timeline.
import { describe, expect, it } from "../../domain/test_bdd.ts";
import {
  agreedRequest,
  builder,
  buildResult,
  discussingRequest,
  goodSpec,
  owner,
  releasingResult,
  routerTested,
  T2,
} from "../../domain/test_fixtures.ts";
import {
  editDetails,
  recordBuildResult,
  recordExport,
} from "../../domain/index.ts";
import { toWebRequest } from "../../capture/views.ts";
import {
  badgeClass,
  GROUPS,
  historyEntries,
  noBuildYet,
  numbered,
  pieceLabels,
  plural,
  SHOWN_PER_STAGE,
  specChanges,
  splitStage,
} from "./words.ts";

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
      "2026-10-23T13:30:00.000Z",
    );
    request = routerTested(request, "answered", "2026-10-23T14:00:00.000Z");
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
        by: "Olive Owner",
        at: "2026-10-23T14:00:00.000Z",
        note: null,
      },
    ]);
  });

  it("lists building and released after agreed, with their own badges", () => {
    expect(GROUPS.flatMap((g) => g.statuses)).toEqual([
      "draft",
      "discussing",
      "ready_for_agreement",
      "agreed",
      "building",
      "released",
      "withdrawn",
      "declined",
      "duplicate",
    ]);
    expect(badgeClass("building")).toBe("badge badge-active");
    expect(badgeClass("released")).toBe("badge badge-delivered");
  });
});

describe("the Build section before a result", () => {
  it("says work has started once it is building, and otherwise that nothing is built", () => {
    expect(noBuildYet("building")).toBe(
      "Work has started. No build result has been recorded yet.",
    );
    // A new version agreed after a build also waits for one.
    expect(noBuildYet("agreed")).toBe(
      "Nothing built from the version agreed now yet.",
    );
  });
});

describe("words", () => {
  it("badges states and counts things", () => {
    expect(badgeClass("ready_for_agreement")).toBe("badge badge-review");
    expect(plural(1, "open question")).toBe("1 open question");
    expect(plural(2, "open question")).toBe("2 open questions");
  });
});

describe("the list's groups", () => {
  const group = (key: string) => GROUPS.find((g) => g.key === key)!;
  const req = (n: number | null, day: number) => ({
    id: n === null ? `old-${day}` : `#${n}`,
    number: n,
    updatedAt: `2026-10-${String(day).padStart(2, "0")}T09:00:00.000Z`,
  });
  const ids = (rs: { id: string }[]) => rs.map((r) => r.id);
  // Numbered against the day, so an order by number and one by date differ.
  const mixed = [3, 9, 1, 7, 5, 8, 2].map((day) => req(10 - day, day));

  it("are named after your next step, closed last and folded away", () => {
    expect(GROUPS.map((g) => [g.heading, g.statuses])).toEqual([
      ["Inbox", ["draft"]],
      ["In progress", ["discussing"]],
      ["To review", ["ready_for_agreement"]],
      ["Ready to build", ["agreed"]],
      ["Building", ["building"]],
      ["Released", ["released"]],
      ["Closed", ["withdrawn", "declined", "duplicate"]],
    ]);
    expect(GROUPS.filter((g) => g.folded).map((g) => g.key)).toEqual([
      "closed",
    ]);
  });

  it("put the longest waiting first in the inbox, to review and ready to build", () => {
    expect(SHOWN_PER_STAGE).toBe(5);
    for (const key of ["inbox", "to-review", "ready-to-build"]) {
      const { shown, rest } = splitStage(group(key), mixed);
      expect(ids(shown)).toEqual(["#9", "#8", "#7", "#5", "#3"]);
      expect(ids(rest)).toEqual(["#2", "#1"]);
    }
  });

  it("put the last updated first in building and released", () => {
    for (const key of ["building", "released"]) {
      const { shown, rest } = splitStage(group(key), mixed);
      expect(ids(shown)).toEqual(["#1", "#2", "#3", "#5", "#7"]);
      expect(ids(rest)).toEqual(["#8", "#9"]);
    }
  });

  it("put in progress in number order, highest first, whenever each was updated", () => {
    // #2 was updated last and #9 longest ago; neither moves.
    const items = [[4, 3], [9, 1], [2, 28], [7, 5], [5, 2], [8, 4], [3, 6]]
      .map(([n, day]) => req(n, day));
    const { shown, rest } = splitStage(group("in-progress"), items);
    expect(ids(shown)).toEqual(["#9", "#8", "#7", "#5", "#4"]);
    expect(ids(rest)).toEqual(["#3", "#2"]);
  });

  it("put in progress requests without a number last, last updated first", () => {
    const items = [req(null, 20), req(1, 2), req(null, 25), req(3, 1)];
    const { shown } = splitStage(group("in-progress"), items);
    expect(ids(shown)).toEqual(["#3", "#1", "old-25", "old-20"]);
  });

  it("keep every closed request behind show, last updated first", () => {
    const { shown, rest } = splitStage(group("closed"), [req(1, 2), req(2, 9)]);
    expect(shown).toEqual([]);
    expect(ids(rest)).toEqual(["#2", "#1"]);
  });

  it("keep nothing back when a group has five or fewer", () => {
    const { shown, rest } = splitStage(
      group("inbox"),
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

describe("specChanges", () => {
  it("names each part that changed, with the lines it lost and gained", () => {
    const after = {
      ...goodSpec,
      desiredOutcome: "Counts are entered once, in either room.",
      scope: { in: [goodSpec.scope.in[0], "A second room"], out: [] },
      acceptanceCriteria: [
        goodSpec.acceptanceCriteria[0],
        { id: "AC2", text: "The order list covers both rooms" },
      ],
    };
    expect(specChanges(goodSpec, after)).toEqual([
      {
        section: "Desired outcome",
        removed: [goodSpec.desiredOutcome],
        added: ["Counts are entered once, in either room."],
      },
      {
        section: "In scope",
        removed: ["Order list"],
        added: ["A second room"],
      },
      { section: "Out of scope", removed: ["Supplier ordering"], added: [] },
      {
        section: "Acceptance criteria",
        removed: ["AC2 The order list matches the spreadsheet for last week"],
        added: ["AC2 The order list covers both rooms"],
      },
    ]);
  });

  it("counts a change to what it reads or writes", () => {
    const write = {
      ...goodSpec,
      effects: { kind: "write" as const, changes: ["pulls main"] },
    };
    expect(specChanges(goodSpec, write)).toEqual([
      {
        section: "Reads or writes",
        removed: [],
        added: ["Changes: pulls main"],
      },
    ]);
    expect(
      specChanges(write, {
        ...goodSpec,
        effects: { kind: "read", changes: [] },
      }),
    ).toEqual([{
      section: "Reads or writes",
      removed: ["Changes: pulls main"],
      added: ["Only reads"],
    }]);
  });

  it("finds nothing between a version and a copy of it", () => {
    expect(specChanges(goodSpec, structuredClone(goodSpec))).toEqual([]);
  });

  it("counts a recipe added to a spec saved without one", () => {
    const { recipe: _, ...noRecipe } = goodSpec;
    expect(specChanges(noRecipe, goodSpec).map((c) => c.section)).toEqual([
      "Recipe",
      "When there is nothing to show",
    ]);
  });
});
