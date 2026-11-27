// The app's steps, each a run of the @puddleworks/capture-app-step workflow,
// which also brings in a stand-in agent's turn as the Slack app does.
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
import { followStep, type StepOutcome } from "./step_events.ts";

export const STEP_WORKFLOW = "@puddleworks/capture-app-step";

/**
 * Runs one step; a refusal comes back in Capture's words. The app stops
 * following once the step is taken, before any stand-in's turn (step_events.ts).
 */
export async function takeStep(
  client: SwampClient,
  inputs: Record<string, string | number>,
): Promise<StepOutcome> {
  try {
    return await followStep(
      client.workflowRunStream({ workflowIdOrName: STEP_WORKFLOW, inputs }),
    );
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
