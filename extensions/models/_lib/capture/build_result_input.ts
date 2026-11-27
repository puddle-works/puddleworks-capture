// record_build_result takes a build result, and revise_specification an
// outcome spec, as an object, JSON text, a file path (relative to the
// repository) or an https URL. This reads it, without checking it is one;
// the service does that.
import { DomainError } from "../domain/index.ts";

export interface JsonInputDeps {
  /** Where a relative path is read from. */
  repoDir: string;
  fetch: (url: string) => Promise<Response>;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new DomainError(
      "invalid_input",
      `The ${what} isn't JSON: ${(e as Error).message}`,
    );
  }
}

/**
 * Why a build result typed into an app for request `requestId` is refused,
 * or null. From an app it is never a path on the machine Capture runs on:
 * only JSON, which must be for that request, or an https URL.
 */
export function appBuildResultProblem(
  result: string,
  requestId: string,
): string | null {
  const given = result.trim();
  if (given.startsWith("{")) {
    let url = "";
    try {
      url = String(JSON.parse(given)?.source?.url ?? "");
    } catch {
      return "That build result isn't valid JSON.";
    }
    return url.endsWith(`/requests/${requestId}`)
      ? null
      : "That build result is for another request; record it from that request.";
  }
  return given.startsWith("https://")
    ? null
    : "Give the build result as its https URL or its JSON.";
}

export async function readJsonInput(
  value: unknown,
  { repoDir, fetch }: JsonInputDeps,
  what = "build result",
): Promise<unknown> {
  if (typeof value !== "string") return value;
  const given = value.trim();
  if (given.startsWith("{")) return parseJson(given, what);
  if (given.startsWith("http://")) {
    throw new DomainError(
      "invalid_input",
      `Fetch a ${what} over https, not http.`,
    );
  }
  if (given.startsWith("https://")) {
    const response = await fetch(given);
    if (!response.ok) {
      throw new DomainError(
        "invalid_input",
        `${given} answered ${response.status}, not a ${what}.`,
      );
    }
    return parseJson(await response.text(), what);
  }
  const file = given.startsWith("/") ? given : `${repoDir}/${given}`;
  try {
    return parseJson(await Deno.readTextFile(file), what);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new DomainError(
        "invalid_input",
        `There is no file ${given} in the repository.`,
      );
    }
    throw e;
  }
}
