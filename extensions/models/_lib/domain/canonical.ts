import type { SpecificationContent } from "./model.ts";

/** JSON with object keys sorted at every depth, so equal data gives equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** The text whose SHA-256 is an agreement's specHash. */
export function specHashInput(content: SpecificationContent): string {
  return canonicalJson(content);
}
