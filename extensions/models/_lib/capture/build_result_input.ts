// record_build_result takes a build result as an object, JSON text, a file
// path (relative to the repository) or an https URL. This reads it, without
// checking it is one; the service does that.
import { DomainError } from "../domain/index.ts";

export interface BuildResultInputDeps {
  /** Where a relative path is read from. */
  repoDir: string;
  fetch: (url: string) => Promise<Response>;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new DomainError(
      "invalid_input",
      `The build result isn't JSON: ${(e as Error).message}`,
    );
  }
}

export async function readBuildResultInput(
  value: unknown,
  { repoDir, fetch }: BuildResultInputDeps,
): Promise<unknown> {
  if (typeof value !== "string") return value;
  const given = value.trim();
  if (given.startsWith("{")) return parseJson(given);
  if (given.startsWith("http://")) {
    throw new DomainError(
      "invalid_input",
      "Fetch a build result over https, not http.",
    );
  }
  if (given.startsWith("https://")) {
    const response = await fetch(given);
    if (!response.ok) {
      throw new DomainError(
        "invalid_input",
        `${given} answered ${response.status}, not a build result.`,
      );
    }
    return parseJson(await response.text());
  }
  const file = given.startsWith("/") ? given : `${repoDir}/${given}`;
  try {
    return parseJson(await Deno.readTextFile(file));
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
