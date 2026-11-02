import { createFileRoute } from "@tanstack/react-router";
import { evalGold } from "@/lib/jev/gold";
import { buildReliability, type CalibrationReport, type CoverageReport } from "@/lib/jev/calibration";

type PerQtype = {
  qtype: string;
  n: number;
  accuracy: number;
  avgConfidence: number;
  /** Binned Expected Calibration Error for this question type (15 equal-width bins). */
  ece: number;
};

type CalibrationRouteResponse = {
  object: "calibration_report";
  /**
   * Number of labelled gold cases the suite ran. Larger = more representative
   * reliability estimate; the suite ships with all feature axes covered.
   */
  caseCount: number;
  /**
   * Reliability report over ALL predictions (strict + soft tracking-only).
   * Use this for the public "is it calibrated?" claim.
   */
  calibration: CalibrationReport;
  /**
   * Reliability report over STRICT (non-soft, gated) predictions only.
   * Excludes tracking-only calibration cases; use when you want the number
   * that drives the regression gate.
   */
  calibrationStrict: CalibrationReport;
  /**
   * Feature-axis and question-type coverage of the gold suite.
   */
  coverage: CoverageReport;
  /**
   * Per-question-type breakdown: accuracy, mean confidence, and mean absolute
   * calibration error. Choice / Score / Noul differ in difficulty — this table
   * shows where the engine is well-calibrated vs. where it over/under-commits.
   */
  perQtype: PerQtype[];
  generatedAt: string;
};

/**
 * Build the calibration response by running the full gold suite against the
 * default (system-one) engine. The suite is deterministic — no randomness in
 * the local engine — so the same numbers reproduce across restarts.
 *
 * The result is cached in-process (module-level) because evalGold is CPU-bound
 * and the numbers cannot change between deploys; a new deploy always gets a
 * fresh run.
 */
function buildCalibrationResponse(): CalibrationRouteResponse {
  const report = evalGold("system-one");

  // Per-qtype prediction groups, binned the same way as the top-level report —
  // `ece` below is the real binned Expected Calibration Error for that question
  // type (not a single-bucket |accuracy - avgConfidence| scalar).
  const byQtype = new Map<string, (typeof report.predictions)[number][]>();
  for (const p of report.predictions) {
    const group = byQtype.get(p.qtype) ?? [];
    group.push(p);
    byQtype.set(p.qtype, group);
  }

  const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

  const perQtype: PerQtype[] = [...byQtype.entries()].map(([qtype, preds]) => {
    const qReport = buildReliability(preds);
    return {
      qtype,
      n: qReport.totalPredictions,
      accuracy: round4(qReport.overallAccuracy),
      avgConfidence: round4(qReport.avgConfidence),
      ece: round4(qReport.ece),
    };
  });

  return {
    object: "calibration_report",
    caseCount: report.caseCount,
    calibration: report.calibration,
    calibrationStrict: report.calibrationStrict,
    coverage: report.coverage,
    perQtype,
    generatedAt: new Date().toISOString(),
  };
}

// Module-level cache — rebuilt once per process lifetime (per deploy). The
// gold suite is deterministic so values are stable within a deploy.
let _cached: CalibrationRouteResponse | null = null;

/**
 * GET /api/v1/calibration
 *
 * Returns the engine's reliability curve and calibration report as JSON — the
 * public machine-readable proof that the System One engine is calibrated (i.e.
 * its stated confidence tracks empirical accuracy).
 *
 * The response includes:
 *   - bins: per-confidence-bucket accuracy vs. mean confidence
 *   - ece: Expected Calibration Error (lower is better)
 *   - mce: Maximum Calibration Error across non-empty bins
 *   - brier: Brier score (lower is better)
 *   - overallAccuracy: fraction of correct top-predictions
 *   - perQtype: per-question-type breakdown (choice / score / noul)
 *   - coverage: feature axes and question-type coverage of the gold suite
 *
 * Result is cached in-process and served with a 1-hour public cache header;
 * the numbers are stable within a deploy.
 */
export const Route = createFileRoute("/api/v1/calibration")({
  server: {
    handlers: {
      GET: async () => {
        if (!_cached) {
          _cached = buildCalibrationResponse();
        }
        return Response.json(_cached, {
          headers: { "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
