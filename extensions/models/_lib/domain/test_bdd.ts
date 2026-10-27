// The domain's tests were first written for vitest. std's bdd runs them under
// deno test, and this expect has the part of vitest's they use. The capture
// service tests use it too, with `expect.rejects` for what a use case refuses.
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertObjectMatch,
  assertStrictEquals,
  fail,
} from "@std/assert";

export { describe, it } from "@std/testing/bdd";

/** Stands for any value that passes `test`, like vitest's expect.objectContaining. */
class Matcher {
  constructor(
    readonly test: (value: unknown) => boolean,
    readonly shown: string,
  ) {}
}

function matches(value: unknown, expected: unknown): boolean {
  if (expected instanceof Matcher) return expected.test(value);
  if (expected !== null && typeof expected === "object") {
    if (value === null || typeof value !== "object") return false;
    return Object.entries(expected).every(([k, v]) =>
      matches((value as Record<string, unknown>)[k], v)
    );
  }
  return Object.is(value, expected);
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  fail("Expected the function to throw, but it returned.");
}

// deno-lint-ignore no-explicit-any
type Expected = Matcher | (new (...args: any[]) => Error);

function checkThrown(error: unknown, expected?: Expected): void {
  if (expected === undefined) return;
  if (!(expected instanceof Matcher)) return assertInstanceOf(error, expected);
  const { code, message } = error as { code?: unknown; message?: unknown };
  assert(
    matches(error, expected),
    `threw ${JSON.stringify({ code, message })}, wanted ${expected.shown}`,
  );
}

function expectValue(actual: unknown) {
  return {
    toBe: (expected: unknown) => assertStrictEquals(actual, expected),
    toEqual: (expected: unknown) => assertEquals(actual, expected),
    toMatchObject: (expected: Record<string, unknown>) =>
      assertObjectMatch(actual as Record<string, unknown>, expected),
    toHaveLength: (n: number) =>
      assertEquals((actual as { length: number }).length, n),
    toContain: (item: unknown) =>
      assert((actual as unknown[]).includes(item), `${item} isn't there`),
    // deno-lint-ignore no-explicit-any
    toBeInstanceOf: (type: abstract new (...args: any[]) => unknown) =>
      assertInstanceOf(actual, type),
    toMatch: (pattern: RegExp) =>
      assert(
        pattern.test(String(actual)),
        `${actual} doesn't match ${pattern}`,
      ),
    toThrowError: (expected?: Expected) =>
      checkThrown(thrownBy(actual as () => unknown), expected),
    not: {
      toContain: (item: unknown) =>
        assert(!(actual as unknown[]).includes(item), `${item} is there`),
    },
  };
}

export const expect = Object.assign(expectValue, {
  objectContaining: (shape: Record<string, unknown>) =>
    new Matcher(
      (v) => matches(v, shape),
      `an object like ${JSON.stringify(shape)}`,
    ),
  stringContaining: (part: string) =>
    new Matcher(
      (v) => typeof v === "string" && v.includes(part),
      `text containing "${part}"`,
    ),
  unreachable: (): never => fail("This line should not be reached."),
  /** Waits for `promise` and checks it was refused as `expected` says. */
  rejects: async (promise: Promise<unknown>, expected?: Expected) => {
    try {
      await promise;
    } catch (e) {
      return checkThrown(e, expected);
    }
    fail("Expected the promise to be refused, but it resolved.");
  },
});
