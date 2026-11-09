// One request with everything on it: details, people, discussion, the
// specification and its versions, agreements, exports, builds and history.
import { Fragment, h } from "preact";
import type { Message } from "../../domain/model.ts";
import type { OldHistory, WebRequest } from "../../capture/view_types.ts";
import { RequestLinks } from "./list.ts";
import {
  badgeClass,
  FORMAT,
  formatTime,
  historyEntries,
  noBuildYet,
  numbered,
  pieceLabels,
  plural,
  ROLE,
  STATUS,
  words,
} from "./words.ts";

type Spec = WebRequest["specifications"][number];

type Build = WebRequest["buildResults"][number];

export function RequestPage({ request }: {
  request: WebRequest;
}) {
  return h(
    Fragment,
    null,
    h("a", { class: "back-link", href: "/" }, "All requests"),
    h(Request, { request: request }),
  );
}

function Request({ request: r }: {
  request: WebRequest;
}) {
  return h(
    Fragment,
    null,
    h(
      "div",
      { class: "show-header" },
      h("h1", null, numbered(r)),
      h(
        "div",
        { class: "show-meta" },
        h("span", { class: badgeClass(r.status) }, STATUS[r.status]),
        h(
          "span",
          null,
          "Raised by ",
          r.outcomeOwner.name,
          " · ",
          formatTime(r.createdAt),
        ),
        h("span", null, "Updated ", formatTime(r.updatedAt)),
        r.openQuestionCount > 0 &&
          h("span", null, plural(r.openQuestionCount, "open question")),
        r.duplicates.length > 0 &&
          h(
            "span",
            null,
            "Asked ",
            r.duplicates.length + 1,
            " times:",
            " ",
            h(RequestLinks, { refs: r.duplicates }),
          ),
      ),
      r.duplicateOf &&
        h(
          "p",
          { class: "closed-reason" },
          "A duplicate of ",
          h(RequestLinks, { refs: [r.duplicateOf] }),
        ),
      r.closedReason && h("p", { class: "closed-reason" }, r.closedReason),
      h("p", { class: "card-meta request-id" }, h("code", null, r.id)),
    ),
    h(
      "section",
      { "aria-labelledby": "details-heading" },
      h("h2", { id: "details-heading" }, "Details"),
      h("h3", null, "What they asked for"),
      h(Text, { value: r.initialDescription }),
      r.requestedPhrase &&
        h(
          Fragment,
          null,
          h("h3", null, "Asked as"),
          h(
            "p",
            { class: "prose requested-phrase" },
            "“",
            r.requestedPhrase,
            "”",
          ),
        ),
      h("h3", null, "How it's done today"),
      h(Text, { value: r.currentProcess }),
    ),
    h(People, { request: r }),
    h(Discussion, { request: r }),
    h(Specifications, { request: r }),
    (r.buildResults.length > 0 || r.status === "building") &&
      h(Builds, { request: r }),
    h(History, { request: r }),
    r.before && h(Before, { before: r.before }),
  );
}

function Text({ value }: {
  value: string;
}) {
  return value.trim()
    ? h("p", { class: "prose" }, value)
    : h("p", { class: "empty" }, "Not written.");
}

function People({ request }: {
  request: WebRequest;
}) {
  return h(
    "section",
    { "aria-labelledby": "people-heading" },
    h("h2", { id: "people-heading" }, "People"),
    h(
      "ul",
      { class: "people" },
      request.participants.map((p) =>
        h(
          "li",
          { key: p.userId },
          h("span", { class: "person-name" }, p.name),
          h("span", { class: "card-meta" }, p.email),
          h("span", { class: "badge badge-draft" }, ROLE[p.role]),
          h("span", { class: "card-meta" }, "joined ", formatTime(p.joinedAt)),
        )
      ),
    ),
  );
}

const KIND: Record<Message["kind"], string> = {
  comment: "Comment",
  question: "Question",
  decision: "Decision",
};

function Discussion({ request }: {
  request: WebRequest;
}) {
  const { messages } = request;
  return h(
    "section",
    { "aria-labelledby": "discussion-heading" },
    h("h2", { id: "discussion-heading" }, "Discussion"),
    messages.length === 0 ? h("p", { class: "empty" }, "Nothing said yet.") : h(
      "ol",
      { class: "messages" },
      messages.map((m) => {
        const open = m.kind === "question" && !m.resolvedAt;
        const answer = m.resolutionMessageId
          ? messages.find((x) => x.id === m.resolutionMessageId)
          : undefined;
        return h(
          "li",
          {
            key: m.id,
            id: `message-${m.id}`,
            class: `message message-${open ? "open" : m.kind}`,
          },
          h(
            "div",
            { class: "message-meta" },
            h("strong", null, m.authorName),
            h("span", null, KIND[m.kind]),
            h("span", null, formatTime(m.createdAt)),
            open && h("span", { class: "badge" }, "Open"),
            m.resolvedAt &&
              h(
                "span",
                { class: "badge badge-delivered" },
                "Resolved ",
                formatTime(m.resolvedAt),
              ),
          ),
          h("p", { class: "prose" }, m.body),
          answer &&
            h(
              "p",
              { class: "card-meta" },
              "Answered by ",
              answer.authorName,
              ": “",
              excerpt(answer.body),
              "”",
            ),
        );
      }),
    ),
  );
}

const excerpt = (text: string) =>
  text.length > 120 ? `${text.slice(0, 117)}…` : text;

function Specifications({ request }: {
  request: WebRequest;
}) {
  const versions = request.specifications;
  const latest = versions.at(-1);
  return h(
    "section",
    { "aria-labelledby": "spec-heading" },
    h("h2", { id: "spec-heading" }, "Specification"),
    latest
      ? h(Version, { spec: latest })
      : h("p", { class: "empty" }, "No specification yet."),
    request.agreements.length > 0 &&
      h(
        Fragment,
        null,
        h("h3", null, "Agreements"),
        h(
          "ul",
          { class: "agreements" },
          request.agreements.map((a) =>
            h(
              "li",
              { key: `${a.specVersion}-${a.agreedAt}` },
              "Version ",
              a.specVersion,
              " agreed by ",
              a.agreedBy.name,
              " ·",
              " ",
              formatTime(a.agreedAt),
              " ",
              h(
                "code",
                { title: "SHA-256 of the agreed content" },
                a.specHash.slice(0, 12),
              ),
            )
          ),
        ),
      ),
    request.exports.length > 0 &&
      h(
        Fragment,
        null,
        h("h3", null, "Exports"),
        h(
          "ul",
          { class: "agreements" },
          request.exports.map((e) =>
            h(
              "li",
              { key: `${e.format}-${e.exportedAt}` },
              FORMAT[e.format],
              " of version ",
              e.specVersion,
              " by",
              " ",
              e.exportedByName,
              " · ",
              formatTime(e.exportedAt),
            )
          ),
        ),
      ),
    versions.length > 1 &&
      h(
        Fragment,
        null,
        h("h3", null, "Earlier versions"),
        h(
          "ul",
          { "aria-label": "Earlier versions", class: "versions" },
          versions.slice(0, -1).reverse().map((v) =>
            h(
              "li",
              { key: v.version },
              h(
                "details",
                null,
                h(
                  "summary",
                  { class: "link-button" },
                  "Version ",
                  v.version,
                  " · ",
                  words(v.status),
                  " ·",
                  " ",
                  formatTime(v.updatedAt),
                ),
                h("div", { class: "older-version" }, h(Version, { spec: v })),
              ),
            )
          ),
        ),
      ),
  );
}

function Version({ spec }: {
  spec: Spec;
}) {
  const { content } = spec;
  return h(
    "div",
    { class: "spec" },
    h(
      "p",
      { class: "spec-version" },
      "Version ",
      spec.version,
      " · ",
      words(spec.status),
    ),
    h(
      "p",
      { class: "card-meta" },
      "Started by ",
      spec.createdByName,
      " · last saved",
      " ",
      formatTime(spec.updatedAt),
    ),
    spec.status === "draft" && spec.problems.length > 0 &&
      h(
        "div",
        { class: "problems" },
        h("p", null, "Before it can be proposed:"),
        h("ul", null, spec.problems.map((p) => h("li", { key: p }, p))),
      ),
    h("h3", null, "Problem statement"),
    h(Text, { value: content.problemStatement }),
    h("h3", null, "Desired outcome"),
    h(Text, { value: content.desiredOutcome }),
    h(List, { title: "In scope", items: content.scope.in }),
    h(List, { title: "Out of scope", items: content.scope.out }),
    h(List, { title: "Constraints", items: content.constraints }),
    h(List, { title: "Assumptions", items: content.assumptions }),
    h("h3", null, "Acceptance criteria"),
    content.acceptanceCriteria.length === 0
      ? h("p", { class: "empty" }, "None yet.")
      : h(
        "dl",
        { class: "criteria" },
        content.acceptanceCriteria.map((c) =>
          h("div", { key: c.id }, h("dt", null, c.id), h("dd", null, c.text))
        ),
      ),
    h(RecipeView, { recipe: content.recipe }),
    h(EffectsView, { effects: content.effects }),
    spec.basedOnMessageIds.length > 0 &&
      h(
        "p",
        { class: "card-meta" },
        "Draws on ",
        plural(spec.basedOnMessageIds.length, "decision"),
        " ",
        "from the discussion.",
      ),
  );
}

/** What the recipe must answer, and what it starts from. */
function RecipeView({ recipe }: {
  recipe: Spec["content"]["recipe"];
}) {
  if (!recipe) {
    return h(
      Fragment,
      null,
      h("h3", null, "Recipe"),
      h("p", { class: "empty" }, "None yet."),
    );
  }
  return h(
    Fragment,
    null,
    h("h3", null, "Recipe"),
    recipe.examples.length === 0
      ? h("p", { class: "empty" }, "No examples yet.")
      : h(
        "dl",
        { class: "examples" },
        recipe.examples.map((e, n) =>
          h(
            "div",
            { key: n },
            h("dt", null, "“", e.phrase, "”"),
            e.answer.trim()
              ? h("dd", null, e.answer)
              : h("dd", { class: "empty" }, "No answer yet."),
          )
        ),
      ),
    h("h3", null, "When there is nothing to show"),
    h(Text, { value: recipe.whenEmpty }),
    recipe.pieces.length > 0 &&
      h(List, {
        title: "Taken from the phrase",
        items: pieceLabels(recipe.pieces),
      }),
    recipe.candidateExtensions.length > 0 &&
      h(List, {
        title: "Extensions to start from",
        items: recipe.candidateExtensions,
      }),
  );
}

/** Whether it only reads or also changes things. None counts as changing things. */
function EffectsView({ effects }: {
  effects: Spec["content"]["effects"];
}) {
  return h(
    Fragment,
    null,
    h("h3", null, "Reads or writes"),
    !effects
      ? h("p", { class: "empty" }, "Not said, so it counts as changing things.")
      : effects.kind === "read"
      ? h("p", null, "It only reads; it changes nothing.")
      : h(
        Fragment,
        null,
        h("p", null, "It changes things:"),
        h("ul", null, effects.changes.map((c, n) => h("li", { key: n }, c))),
      ),
  );
}

function List({ title, items }: {
  title: string;
  items: string[];
}) {
  return h(
    Fragment,
    null,
    h("h3", null, title),
    items.length === 0
      ? h("p", { class: "empty" }, "None.")
      : h("ul", null, items.map((i, n) => h("li", { key: n }, i))),
  );
}

const CHECK: Record<Build["examples"][number]["outcome"], [
  string,
  string,
]> = {
  passed: ["Passed", "delivered"],
  failed: ["Failed", "closed"],
  missing: ["Not reported", "review"],
};

/** The build that stands for the agreed version, then every one recorded. */
function Builds({ request }: {
  request: WebRequest;
}) {
  const { build } = request;
  return h(
    "section",
    { "aria-labelledby": "build-heading" },
    h("h2", { id: "build-heading" }, "Build"),
    build
      ? h(BuildView, { build: build, released: request.status === "released" })
      : h(
        "p",
        { class: "empty" },
        noBuildYet(request.status),
      ),
    request.buildResults.length > 0 && h("h3", null, "Build results"),
    request.buildResults.length > 0 && h(
      "ul",
      { class: "agreements" },
      request.buildResults.map((b) =>
        h(
          "li",
          { key: `${b.recordedAt}-${b.result.builtAt}` },
          "Version ",
          b.specVersion,
          ", built ",
          formatTime(b.result.builtAt),
          " on",
          " ",
          h("code", null, b.result.buildRef),
          b.result.published && ` · published ${b.result.published.version}`,
          " ",
          "· recorded by ",
          b.recordedByName,
        )
      ),
    ),
  );
}

function BuildView({ build, released }: {
  build: Build;
  released: boolean;
}) {
  const { result } = build;
  return h(
    "div",
    { class: "spec" },
    h(
      "p",
      { class: "spec-version" },
      result.extension,
      " · built from version ",
      build.specVersion,
    ),
    h(
      "p",
      { class: "card-meta" },
      "Built ",
      formatTime(result.builtAt),
      " · recorded by ",
      build.recordedByName,
      " ",
      formatTime(build.recordedAt),
    ),
    !released && build.releaseProblems.length > 0 &&
      h(
        "div",
        { class: "problems" },
        h("p", null, "Before it is released:"),
        h("ul", null, build.releaseProblems.map((p) => h("li", { key: p }, p))),
      ),
    h(
      "dl",
      { class: "build-facts" },
      h(
        "div",
        null,
        h("dt", null, "Source"),
        h(
          "dd",
          null,
          h("a", { href: result.repository }, result.repository),
          result.path && h(Fragment, null, "at ", h("code", null, result.path)),
          ", on ",
          h("code", null, result.buildRef),
        ),
      ),
      h(
        "div",
        null,
        h("dt", null, "Pull request"),
        result.pullRequest
          ? h(
            "dd",
            null,
            h("a", { href: result.pullRequest }, result.pullRequest),
          )
          : h("dd", { class: "empty" }, "None yet."),
      ),
      h(
        "div",
        null,
        h("dt", null, "Published"),
        result.published
          ? h(
            "dd",
            null,
            result.published.version,
            ", ",
            result.published.visibility,
            build.registryUrl &&
              h(
                Fragment,
                null,
                " ",
                "· ",
                h("a", { href: build.registryUrl }, result.extension),
              ),
          )
          : h("dd", { class: "empty" }, "Not yet."),
      ),
      h(
        "div",
        null,
        h("dt", null, "Run with"),
        h("dd", null, h("code", null, result.entryPointRef)),
      ),
    ),
    h("h3", null, "Examples"),
    build.examples.length === 0
      ? h("p", { class: "empty" }, "The agreed spec has no recipe examples.")
      : h(
        "dl",
        { class: "examples" },
        build.examples.map((e) => {
          const [label, badge] = CHECK[e.outcome];
          return h(
            "div",
            { key: e.phrase },
            h(
              "dt",
              null,
              "“",
              e.phrase,
              "”",
              " ",
              h("span", { class: `badge badge-${badge}` }, label),
              e.requested &&
                h("span", { class: "badge badge-draft" }, "Requested"),
            ),
            e.detail && h("dd", null, e.detail),
          );
        }),
      ),
  );
}

function History({ request }: {
  request: WebRequest;
}) {
  const list = historyEntries(request);
  return h(
    "section",
    { "aria-labelledby": "history-heading" },
    h("h2", { id: "history-heading" }, "History"),
    h(
      "ol",
      { class: "timeline" },
      list.map((e, n) =>
        h(
          "li",
          { key: n, class: n === list.length - 1 ? "current" : undefined },
          h("div", { class: "tl-label" }, e.label),
          h("div", { class: "tl-meta" }, e.by, " · ", formatTime(e.at)),
          e.note && h("div", { class: "tl-note" }, e.note),
        )
      ),
    ),
  );
}

function Before({ before }: {
  before: OldHistory;
}) {
  return h(
    "section",
    { "aria-labelledby": "before-heading" },
    h("h2", { id: "before-heading" }, "Before Capture"),
    h(
      "p",
      null,
      "Imported from Puddleworks, where it was ",
      h("code", null, before.name),
      ", last",
      " ",
      words(before.state),
      ".",
    ),
    before.transitions.length > 0 &&
      h(
        "ol",
        { class: "timeline" },
        before.transitions.map((t, n) =>
          h(
            "li",
            { key: n },
            h(
              "div",
              { class: "tl-label" },
              t.from ? `${words(t.from)} → ${words(t.to)}` : words(t.to),
            ),
            h("div", { class: "tl-meta" }, formatTime(t.at)),
            t.note && h("div", { class: "tl-note" }, t.note),
          )
        ),
      ),
  );
}
