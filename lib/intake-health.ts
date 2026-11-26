// Is job intake healthy? Read from the AI service's own run history
// ("IntakeRun", ai-service/intake_history.py). /api/admin/intake-health calls
// this, then emails whatever is new.
//
// From 2026-10-20 to 2026-11-25 the daily pipeline stored nothing. By
// 2 November cleanup had deactivated every job, and nobody heard about it.
// What counts as unhealthy:
//   - no daily run has started for STALE_HOURS (the scheduler stopped, or the
//     service is down);
//   - a daily run still "running" after STUCK_HOURS (longer than all of
//     scheduler.STEP_TIMEOUT_S together, so its time limits didn't work);
//   - the newest finished daily run listed problems (it stored 0 jobs, a step
//     failed or timed out, Active Jobs DB refused every market, matching
//     failed for a user).

export const STALE_HOURS = 48;
export const STUCK_HOURS = 9; // the step limits add up to 7.5 h
/** A still-true "no run" alert is sent again after this long. */
export const STALE_REPEAT_HOURS = 24;

export interface IntakeRun {
  id: string;
  kind: string;
  trigger: string;
  status: string; // running | ok | problems | failed
  started_at: Date;
  finished_at: Date | null;
  jobs_stored: number | null;
  problems: string[];
}

export interface IntakeFinding {
  /** Dedupe key: one email per key, or one per `repeatHours` while it lasts. */
  key: string;
  message: string;
  repeatHours: number | null;
}

const HOUR = 3600 * 1000;

function when(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** `runs`: daily runs of the last 7 days, any order. */
export function evaluateIntake(runs: IntakeRun[], now: Date): IntakeFinding[] {
  const daily = runs.filter((r) => r.kind === "daily").sort((a, b) => b.started_at.getTime() - a.started_at.getTime());
  const findings: IntakeFinding[] = [];

  const newest = daily[0];
  if (!newest || now.getTime() - newest.started_at.getTime() > STALE_HOURS * HOUR) {
    findings.push({
      key: "stale",
      message: newest
        ? `No daily intake run has started since ${when(newest.started_at)} (over ${STALE_HOURS} h). The scheduler isn't firing or the AI service is down.`
        : `No daily intake run in the last 7 days. The scheduler isn't firing, the AI service is down, or it can't write "IntakeRun".`,
      repeatHours: STALE_REPEAT_HOURS,
    });
  }

  for (const r of daily) {
    if (r.status === "running" && now.getTime() - r.started_at.getTime() > STUCK_HOURS * HOUR) {
      findings.push({
        key: `stuck:${r.id}`,
        message: `The daily run that started ${when(r.started_at)} is still "running" after ${STUCK_HOURS} h, past every step's time limit: it's hung, or the AI service restarted mid-run and never closed its record.`,
        repeatHours: null,
      });
    }
  }

  const lastFinished = daily.find((r) => r.status !== "running");
  if (lastFinished && lastFinished.problems.length > 0) {
    findings.push({
      key: `run:${lastFinished.id}`,
      message:
        `The daily run of ${when(lastFinished.started_at)} stored ${lastFinished.jobs_stored ?? 0} jobs:\n` +
        lastFinished.problems.map((p) => `  - ${p}`).join("\n"),
      repeatHours: null,
    });
  }
  return findings;
}

/** Findings to email now: never sent, or sent longer ago than repeatHours. */
export function findingsToSend(
  findings: IntakeFinding[],
  sent: Map<string, Date>,
  now: Date,
): IntakeFinding[] {
  return findings.filter((f) => {
    const at = sent.get(f.key);
    if (!at) return true;
    return f.repeatHours !== null && now.getTime() - at.getTime() >= f.repeatHours * HOUR;
  });
}
