/**
 * Offline calibration fitter (refit tool — NOT in the hot path).
 *
 * Runs the deterministic engine over the whole gold suite, collects raw
 * peakedness-confidence vs. observed correctness per question type, and fits an
 * ISOTONIC regression (Pool Adjacent Violators, PAVA) mapping raw confidence ->
 * empirical accuracy. The resulting compact knot table is what
 * `calibratedConfidence` in vector.ts interpolates over.
 *
 * HOW TO REFIT after changing the engine, weights, or the gold set:
 *
 *   OTS_CALIBRATION=identity node --experimental-strip-types scripts/fit-calibration.ts
 *
 * The `OTS_CALIBRATION=identity` env disables calibration inside the engine so
 * the predictions we fit on carry the RAW confidence (otherwise we would be
 * fitting a map on top of an already-calibrated signal). Copy the printed
 * `CALIBRATION_KNOTS` block into src/lib/jev/vector.ts and re-run `npm run gold`.
 */

process.env.OTS_CALIBRATION = "identity";

const { evalGold } = await import("../src/lib/jev/gold.ts");

type Pt = { x: number; y: number };

/** Isotonic regression via PAVA. Returns non-decreasing blocks over sorted x. */
function pava(points: Pt[]): Array<{ y: number; w: number; xsum: number }> {
  const pts = points.slice().sort((a, b) => a.x - b.x);
  const blocks: Array<{ y: number; w: number; xsum: number }> = [];
  for (const p of pts) {
    let blk = { y: p.y, w: 1, xsum: p.x };
    // Pool with previous blocks while the sequence would decrease (violation).
    while (blocks.length > 0 && (blocks[blocks.length - 1]?.y ?? 0) >= blk.y) {
      const prev = blocks.pop()!;
      const w = prev.w + blk.w;
      blk = {
        y: (prev.y * prev.w + blk.y * blk.w) / w,
        w,
        xsum: prev.xsum + blk.xsum,
      };
    }
    blocks.push(blk);
  }
  return blocks;
}

/** Turn PAVA blocks into interpolation knots pinned at x=0 and x=1. */
function knots(points: Pt[]): Array<[number, number]> {
  if (points.length === 0) return [[0, 0], [1, 1]];
  const blocks = pava(points);
  const raw: Array<[number, number]> = blocks.map((b) => [
    round(b.xsum / b.w),
    round(b.y),
  ]);
  const out: Array<[number, number]> = [];
  if ((raw[0]?.[0] ?? 0) > 0) out.push([0, raw[0]?.[1] ?? 0]);
  for (const k of raw) {
    // Drop duplicate x (keep monotonic, unique-x knots).
    if (out.length && out[out.length - 1]?.[0] === k[0]) continue;
    out.push(k);
  }
  const lastX = out[out.length - 1]?.[0] ?? 1;
  if (lastX < 1) out.push([1, out[out.length - 1]?.[1] ?? 1]);
  return out;
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

const r = evalGold("system-one");
const byType: Record<string, Pt[]> = { choice: [], score: [], noul: [] };
for (const p of r.predictions) {
  byType[p.qtype]?.push({ x: p.confidence, y: p.correct ? 1 : 0 });
}

const fitted: Record<string, Array<[number, number]>> = {};
for (const t of ["choice", "score", "noul"]) {
  fitted[t] = knots(byType[t] ?? []);
}

console.log("// Refit " + new Date().toISOString().slice(0, 10) + " via scripts/fit-calibration.ts");
console.log("const CALIBRATION_KNOTS: Record<Qtype, ReadonlyArray<readonly [number, number]>> = {");
for (const t of ["choice", "score", "noul"]) {
  const ks = (fitted[t] ?? []).map((k) => `[${k[0]}, ${k[1]}]`).join(", ");
  console.log(`  ${t}: [${ks}],`);
}
console.log("};");

// Diagnostics: pre/post ECE per type.
for (const t of ["choice", "score", "noul"]) {
  const pts = byType[t] ?? [];
  const ks = fitted[t] ?? [];
  const interp = (x: number): number => {
    if (ks.length === 0) return x;
    if (x <= (ks[0]?.[0] ?? 0)) return ks[0]?.[1] ?? x;
    for (let i = 1; i < ks.length; i++) {
      const a = ks[i - 1]!;
      const b = ks[i]!;
      if (x <= b[0]) {
        const span = b[0] - a[0] || 1;
        return a[1] + ((x - a[0]) / span) * (b[1] - a[1]);
      }
    }
    return ks[ks.length - 1]?.[1] ?? x;
  };
  const acc = pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : 0;
  const rawConf = pts.length ? pts.reduce((s, p) => s + p.x, 0) / pts.length : 0;
  const calConf = pts.length ? pts.reduce((s, p) => s + interp(p.x), 0) / pts.length : 0;
  console.log(
    `// ${t}: n=${pts.length} acc=${acc.toFixed(3)} rawAvgConf=${rawConf.toFixed(3)} calAvgConf=${calConf.toFixed(3)}`,
  );
}
