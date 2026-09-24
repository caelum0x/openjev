/**
 * Offline temperature-schedule search (refit tool — NOT in the hot path).
 *
 * Grid-searches the `adaptiveTemp` schedule (in engine.ts) for the band temps
 * that minimize the RAW (pre-calibration) Expected Calibration Error over the
 * gold suite, so the reported confidences track accuracy as closely as possible
 * before the isotonic map is even applied. Prints the best schedule + its ECE.
 *
 * Run:
 *   OTS_CALIBRATION=identity node --experimental-strip-types scripts/fit-temp.ts
 *
 * The engine reads the candidate schedule from OTS_TEMP_SCHEDULE at call time,
 * so we can sweep many candidates in one deterministic process. Paste the
 * winning TEMP_SCHEDULE into engine.ts and re-run scripts/fit-calibration.ts
 * (the calibration map must be refit for the chosen schedule) then `npm run gold`.
 */

process.env.OTS_CALIBRATION = "identity";

const { evalGold } = await import("../src/lib/jev/gold.ts");
const { buildReliability } = await import("../src/lib/jev/calibration.ts");

const breakpoints: Array<[number, number, number]> = [
  [0.12, 0.35, 0.8],
  [0.1, 0.3, 0.7],
  [0.15, 0.4, 0.9],
];
const T1 = [0.55, 0.62, 0.7, 0.8];
const T2 = [0.4, 0.46, 0.52];
const T3 = [0.32, 0.36, 0.42];
const T4 = [0.22, 0.26, 0.3];
const BASE = [0.35, 0.4, 0.45];

function ece(schedule: unknown): number {
  process.env.OTS_TEMP_SCHEDULE = JSON.stringify(schedule);
  const r = evalGold("system-one");
  return buildReliability(r.predictions).ece;
}

// Baseline: the prior ad-hoc schedule.
const baseline = {
  base: 0.4,
  bands: [
    [0.12, 0.7],
    [0.35, 0.48],
    [0.8, 0.36],
    [Number.MAX_VALUE, 0.28],
  ],
};
const baselineEce = ece(baseline);

let best = { ece: Infinity, schedule: baseline as unknown };
for (const [b1, b2, b3] of breakpoints) {
  for (const base of BASE)
    for (const t1 of T1)
      for (const t2 of T2)
        for (const t3 of T3)
          for (const t4 of T4) {
            if (!(t1 > t2 && t2 > t3 && t3 > t4)) continue;
            const schedule = {
              base,
              bands: [
                [b1, t1],
                [b2, t2],
                [b3, t3],
                [Number.MAX_VALUE, t4],
              ],
            };
            const e = ece(schedule);
            if (e < best.ece) best = { ece: e, schedule };
          }
}

const s = best.schedule as { base: number; bands: Array<[number, number]> };
console.log(`// baseline raw ECE = ${baselineEce.toFixed(4)}`);
console.log(`// best raw ECE     = ${best.ece.toFixed(4)}`);
console.log("const TEMP_SCHEDULE: TempSchedule = {");
console.log(`  base: ${s.base},`);
console.log("  bands: [");
for (const [sp, t] of s.bands) {
  const spTxt = sp >= Number.MAX_VALUE ? "Infinity" : sp;
  console.log(`    [${spTxt}, ${t}],`);
}
console.log("  ],");
console.log("};");
