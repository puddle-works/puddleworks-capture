// The app's steps, each a run of the @puddleworks/capture-app-step workflow.
// Serve records who started a run, and the workflow gives Capture that login
// (run.initiatedBy), so the app never says who acts: Capture finds the person
// by their swamp login in its people list, and refuses anyone not on it.
import type { SwampClient } from "@swamp-club/app-sdk";
import type { Person } from "../../../models/_lib/domain/model.ts";
import {
  recordObject,
  toPerson,
} from "../../../models/_lib/capture/swamp_store.ts";
import { queryAll } from "./capture_data.ts";

export const STEP_WORKFLOW = "@puddleworks/capture-app-step";

export type StepOutcome =
  | { ok: true; runId: string }
  | { ok: false; error: string };

/** Runs one step and waits for it; a refusal comes back in Capture's words. */
export async function takeStep(
  client: SwampClient,
  inputs: Record<string, string | number>,
): Promise<StepOutcome> {
  try {
    for await (
      const event of client.workflowRunStream({
        workflowIdOrName: STEP_WORKFLOW,
        inputs,
      })
    ) {
      if (event.kind === "error") {
        return { ok: false, error: event.error.message };
      }
      if (event.kind === "cancelled") {
        return { ok: false, error: "The step was cancelled." };
      }
      if (event.kind === "completed") {
        if (event.run.status === "succeeded") {
          return { ok: true, runId: event.run.id };
        }
        const failed = event.run.jobs.flatMap((j) => j.steps)
          .find((s) => s.error);
        return {
          ok: false,
          error: failed?.error ?? `The step ${event.run.status}.`,
        };
      }
    }
    return { ok: false, error: "The step ended without a result." };
  } catch (reason) {
    return {
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

/** Who the person viewing is, by their swamp login; an error says why not. */
export async function whoAmI(
  client: SwampClient,
  behavior: string,
): Promise<{ person: Person } | { error: string }> {
  const nonce = crypto.randomUUID();
  const outcome = await takeStep(client, { step: "whoami", nonce });
  if (!outcome.ok) return { error: outcome.error };
  const [record] = await queryAll(
    client,
    `modelName == "${behavior}" && name == "signed-in-${nonce}"`,
  );
  // Anyone who may run the workflow sees the name once it is written, so
  // only the record this run wrote counts.
  const data = record?.tags?.workflowRunId === outcome.runId
    ? recordObject(record as never)
    : null;
  if (!data || typeof data.email !== "string") {
    return { error: "Capture didn't say who you are." };
  }
  return { person: toPerson(data) };
}
