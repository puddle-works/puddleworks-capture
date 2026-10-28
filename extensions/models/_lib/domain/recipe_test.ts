import { describe, expect, it } from "./test_bdd.ts";
import {
  createRequest,
  editSpecification,
  propose,
  type Recipe,
  type Request,
  specHashInput,
  type SpecificationContent,
  specificationProblems,
  submit,
} from "./index.ts";
import { builder, goodSpec, owner, T0, T1 } from "./test_fixtures.ts";

const PHRASE = "what needs counting this week";

function raised(phrase = PHRASE): Request {
  return createRequest(
    {
      id: "r-2",
      title: "Count list",
      initialDescription: "Asked in chat.",
      phrase,
      candidateExtensions: ["@example/stock"],
    },
    owner,
    T0,
  );
}

/** Submitted, with the builder joined, as discussingRequest() is. */
function discussing(r: Request): Request {
  const submitted = submit(r, owner, T0);
  return {
    ...submitted,
    participants: [...submitted.participants, {
      userId: builder.userId,
      name: builder.name,
      email: builder.email,
      role: "builder",
      invitedBy: null,
      joinedAt: T0,
    }],
  };
}

const answered: Recipe = {
  examples: [{
    phrase: PHRASE,
    answer: "Each shelf due a count, oldest first.",
  }],
  pieces: [],
  whenEmpty: "Nothing needs counting.",
  candidateExtensions: ["@example/stock"],
};

/** goodSpec, answering the requested phrase. */
const raisedSpec: SpecificationContent = {
  ...goodSpec,
  recipe: answered,
  acceptanceCriteria: [
    ...goodSpec.acceptanceCriteria,
    {
      id: "R1",
      text:
        `"${PHRASE}" is answered by a recipe, with no LLM call, as the recipe's examples describe.`,
    },
  ],
};

describe("a requested phrase", () => {
  it("is recorded, and starts the draft spec as its first example with R1", () => {
    const r = raised();
    expect(r.requestedPhrase).toBe(PHRASE);
    expect(r.specifications).toHaveLength(1);
    expect(r.specifications[0]).toMatchObject({
      version: 1,
      status: "draft",
      createdBy: owner.userId,
    });
    const content = r.specifications[0].content;
    expect(content.recipe).toEqual({
      examples: [{ phrase: PHRASE, answer: "" }],
      pieces: [],
      whenEmpty: "",
      candidateExtensions: ["@example/stock"],
    });
    expect(content.acceptanceCriteria).toEqual([{
      id: "R1",
      text:
        `"${PHRASE}" is answered by a recipe, with no LLM call, as the recipe's examples describe.`,
    }]);
  });

  it("isn't there when no phrase is given, and the recipe starts empty", () => {
    const r = createRequest(
      { id: "r-3", title: "Count list", initialDescription: "", phrase: " " },
      owner,
      T0,
    );
    expect(r.requestedPhrase).toBe(undefined);
    expect(r.specifications).toEqual([]);
    const withCandidates = createRequest(
      {
        id: "r-4",
        title: "Count list",
        initialDescription: "",
        candidateExtensions: ["@example/stock"],
      },
      owner,
      T0,
    );
    expect(withCandidates.specifications[0].content.recipe).toEqual({
      examples: [],
      pieces: [],
      whenEmpty: "",
      candidateExtensions: ["@example/stock"],
    });
    expect(withCandidates.specifications[0].content.acceptanceCriteria)
      .toEqual([]);
  });

  it("can't be edited away: reworded or moved is refused", () => {
    const r = discussing(raised());
    const reworded = {
      ...raisedSpec,
      recipe: {
        ...answered,
        examples: [{ phrase: "what to count", answer: "Shelves." }],
      },
    };
    expect(() => editSpecification(r, builder, reworded, [], T1))
      .toThrowError(expect.objectContaining({
        code: "invalid_input",
        message: expect.stringContaining(`"${PHRASE}"`),
      }));
    const moved = {
      ...raisedSpec,
      recipe: {
        ...answered,
        examples: [{ phrase: "what to count", answer: "Shelves." }, {
          ...answered.examples[0],
        }],
      },
    };
    expect(() => editSpecification(r, builder, moved, [], T1))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("keeps an added phrasing after it", () => {
    const more = {
      ...raisedSpec,
      recipe: {
        ...answered,
        examples: [...answered.examples, {
          phrase: "what's due a count",
          answer: "The same list.",
        }],
      },
    };
    const r = editSpecification(discussing(raised()), builder, more, [], T1);
    expect(r.specifications[0].content.recipe?.examples.map((e) => e.phrase))
      .toEqual([PHRASE, "what's due a count"]);
    expect(propose(r, builder, T1).status).toBe("ready_for_agreement");
  });

  it("keeps the recipe when an edit leaves it out", () => {
    const { recipe: _, ...noRecipe } = raisedSpec;
    const r = editSpecification(
      discussing(raised()),
      builder,
      noRecipe,
      [],
      T1,
    );
    expect(r.specifications[0].content.recipe).toEqual(
      raised().specifications[0].content.recipe,
    );
  });
});

describe("recipe problems", () => {
  it("names a spec with no recipe, or a recipe with no examples", () => {
    const { recipe: _, ...noRecipe } = goodSpec;
    const problem =
      "The recipe has no examples: give at least one phrase it must answer, and what the answer shows.";
    expect(specificationProblems(noRecipe)).toEqual([problem]);
    expect(
      specificationProblems({
        ...goodSpec,
        recipe: { ...answered, examples: [] },
      }),
    ).toEqual([problem]);
  });

  it("names an example with no answer", () => {
    expect(
      specificationProblems({
        ...goodSpec,
        recipe: { ...answered, examples: [{ phrase: PHRASE, answer: " " }] },
      }),
    ).toEqual([`The example "${PHRASE}" has no answer.`]);
  });

  it("names a requested phrase that isn't first, or that no criterion names", () => {
    const other = {
      ...goodSpec,
      recipe: {
        ...answered,
        examples: [{ phrase: "what to count", answer: "Shelves." }],
      },
    };
    expect(specificationProblems(other, PHRASE)).toEqual([
      `The requested phrase "${PHRASE}" must be the recipe's first example, as it was asked.`,
      `No acceptance criterion names the requested phrase "${PHRASE}".`,
    ]);
    expect(specificationProblems(raisedSpec, PHRASE)).toEqual([]);
  });
});

describe("proposing", () => {
  it("is refused with no recipe, even for a request stored before recipes", () => {
    const { recipe: _, ...noRecipe } = goodSpec;
    // A draft saved before specs had recipes has none in its content.
    const old = discussing(
      createRequest(
        { id: "r-5", title: "Old", initialDescription: "" },
        owner,
        T0,
      ),
    );
    const stored: Request = {
      ...old,
      specifications: [{
        version: 1,
        status: "draft",
        content: noRecipe,
        basedOnMessageIds: [],
        createdBy: builder.userId,
        createdAt: T0,
        updatedAt: T0,
      }],
    };
    expect(() => propose(stored, builder, T1)).toThrowError(
      expect.objectContaining({
        code: "invalid_state",
        message: expect.stringContaining("The recipe has no examples"),
      }),
    );
  });

  it("is refused while the requested phrase has no answer, or R1 is gone", () => {
    let r = discussing(raised());
    expect(() => propose(r, builder, T1)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(`"${PHRASE}" has no answer`),
      }),
    );
    r = editSpecification(
      r,
      builder,
      {
        ...raisedSpec,
        acceptanceCriteria: goodSpec.acceptanceCriteria,
      },
      [],
      T1,
    );
    expect(() => propose(r, builder, T1)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(
          `No acceptance criterion names the requested phrase`,
        ),
      }),
    );
  });
});

describe("the spec hash", () => {
  it("changes when the recipe does", () => {
    const changed = {
      ...raisedSpec,
      recipe: { ...answered, whenEmpty: "All counted." },
    };
    expect(specHashInput(changed) === specHashInput(raisedSpec)).toBe(false);
  });
});
