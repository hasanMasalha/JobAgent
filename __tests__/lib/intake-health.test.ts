import { evaluateIntake, findingsToSend, type IntakeRun } from "@/lib/intake-health";

// From 2026-10-20 to 2026-11-25 the daily pipeline stored nothing and nothing
// said so. These are the cases that must alert.

const NOW = new Date("2026-11-26T09:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);

function run(over: Partial<IntakeRun> = {}): IntakeRun {
  return {
    id: "r1",
    kind: "daily",
    trigger: "scheduler",
    status: "ok",
    started_at: hoursAgo(4),
    finished_at: hoursAgo(2),
    jobs_stored: 2779,
    problems: [],
    ...over,
  };
}

describe("evaluateIntake", () => {
  it("is healthy after a good run this morning", () => {
    expect(evaluateIntake([run()], NOW)).toEqual([]);
  });

  it("alerts when no daily run has started for 48 hours", () => {
    const f = evaluateIntake([run({ started_at: hoursAgo(49), finished_at: hoursAgo(48) })], NOW);
    expect(f.map((x) => x.key)).toEqual(["stale"]);
    expect(f[0].message).toContain("2026-11-24 08:00 UTC");
    expect(f[0].repeatHours).toBe(24);
  });

  it("alerts when there is no daily run at all", () => {
    expect(evaluateIntake([], NOW).map((x) => x.key)).toEqual(["stale"]);
  });

  it("ignores manual scrapes when deciding whether the daily run happened", () => {
    const f = evaluateIntake([run({ kind: "scrape", started_at: hoursAgo(1) })], NOW);
    expect(f.map((x) => x.key)).toEqual(["stale"]);
  });

  it("alerts once about a run stuck past every time limit", () => {
    const stuck = run({ id: "r9", status: "running", started_at: hoursAgo(10), finished_at: null, jobs_stored: null });
    expect(evaluateIntake([stuck], NOW).map((x) => x.key)).toEqual(["stuck:r9"]);
    // still within its limits: fine
    expect(evaluateIntake([{ ...stuck, started_at: hoursAgo(3) }], NOW)).toEqual([]);
  });

  it("alerts about a run that stored nothing, with its problems", () => {
    const zero = run({ id: "r2", status: "problems", jobs_stored: 0, problems: ["The run stored 0 jobs"] });
    const [f] = evaluateIntake([zero], NOW);
    expect(f.key).toBe("run:r2");
    expect(f.message).toContain("stored 0 jobs");
    expect(f.repeatHours).toBeNull();
  });

  it("goes by the newest finished run: a good run after a bad one clears it", () => {
    const bad = run({ id: "old", started_at: hoursAgo(28), problems: ["Active Jobs DB: the API refused every market"] });
    expect(evaluateIntake([run(), bad], NOW)).toEqual([]);
  });

  it("still reports the last finished run's problems while today's run is going", () => {
    const today = run({ id: "now", status: "running", started_at: hoursAgo(1), finished_at: null });
    const bad = run({ id: "y", started_at: hoursAgo(28), problems: ["Matching failed for 1 of 30 user(s)"] });
    expect(evaluateIntake([today, bad], NOW).map((x) => x.key)).toEqual(["run:y"]);
  });
});

describe("findingsToSend", () => {
  const stale = { key: "stale", message: "m", repeatHours: 24 };
  const once = { key: "run:r2", message: "m", repeatHours: null };

  it("sends what was never sent", () => {
    expect(findingsToSend([stale, once], new Map(), NOW)).toEqual([stale, once]);
  });

  it("sends a one-off alert only once", () => {
    expect(findingsToSend([once], new Map([["run:r2", hoursAgo(100)]]), NOW)).toEqual([]);
  });

  it("repeats 'no run' once a day while it lasts", () => {
    expect(findingsToSend([stale], new Map([["stale", hoursAgo(6)]]), NOW)).toEqual([]);
    expect(findingsToSend([stale], new Map([["stale", hoursAgo(25)]]), NOW)).toEqual([stale]);
  });
});
