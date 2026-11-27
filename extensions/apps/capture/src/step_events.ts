// What a run of @puddleworks/capture-app-step says about the app's step, from
// its events. A stand-in agent's turn may follow in the same run and take
// minutes, so the step counts as done once Capture has said whether one
// follows (the `next` step), and the app stops following; the run goes on.

/** The parts of serve's run events this reads. */
export type StepEvent =
  | { kind: "started"; runId: string; parentRunId?: string }
  | { kind: "step_completed" | "step_skipped"; stepId: string }
  | { kind: "step_failed"; stepId: string; error: string }
  | {
    kind: "completed";
    run: {
      id: string;
      status: string;
      jobs: { steps: { error?: string }[] }[];
    };
  }
  | { kind: "cancelled" }
  | { kind: "error"; error: { message: string } }
  | { kind: string };

export type StepOutcome =
  | { ok: true; runId: string }
  | { ok: false; error: string };

export async function followStep(
  events: AsyncIterable<StepEvent>,
): Promise<StepOutcome> {
  let runId = "";
  let taken = false;
  for await (const e of events) {
    switch (e.kind) {
      case "error":
        return {
          ok: false,
          error: (e as { error: { message: string } }).error.message,
        };
      case "cancelled":
        return { ok: false, error: "The step was cancelled." };
      case "started": {
        const s = e as { runId: string; parentRunId?: string };
        if (!s.parentRunId) runId = s.runId;
        break;
      }
      case "completed": {
        const { run } = e as Extract<StepEvent, { kind: "completed" }>;
        if (run.status === "succeeded" || taken) {
          return { ok: true, runId: run.id };
        }
        const failed = run.jobs.flatMap((j) => j.steps).find((s) => s.error);
        return { ok: false, error: failed?.error ?? `The step ${run.status}.` };
      }
      case "step_completed":
      case "step_skipped":
      case "step_failed": {
        // A nested run's steps have other names.
        const { stepId } = e as { stepId: string };
        if (stepId === "step") {
          if (e.kind === "step_failed") {
            return { ok: false, error: (e as { error: string }).error };
          }
          taken = true;
        } else if (stepId === "next" && taken && runId) {
          return { ok: true, runId };
        }
      }
    }
  }
  return { ok: false, error: "The step ended without a result." };
}
