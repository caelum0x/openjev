import { GOLD, type GoldReport } from "./gold.ts";
import { buildReliability, type CalPrediction, type CalibrationReport } from "./calibration.ts";
import type { Answer, SystemOneRequest, SystemOneResponse } from "./types.ts";

/**
 * Pure scoring logic for "Benchmark Submissions" (Geek Room hackathon
 * capability): everything here is deterministic, has no database or network
 * dependency, and is therefore directly unit-testable — the DB-backed wrapper
 * (benchmark-submissions.server.ts) imports from this module instead of
 * re-implementing any of it, mirroring the existing pure-engine /
 * `*.server.ts`-wrapper split used by calibration.ts + calibration-fit.ts and
 * audit-report.ts + audit-report.server.ts elsewhere in this file.
 *
 * A third party points their own typed-decision model at the SAME 93-case
 * gold calibration suite every OpenJev model is scored on
 * (src/lib/jev/gold.ts) and gets back the SAME accuracy/ECE/adaptive-ECE/
 * MCE/Brier/NLL numbers, computed by the SAME engine (`buildReliability` in
 * calibration.ts, `evalGoldWith` in gold.ts) the internal leaderboard harness
 * (scripts/leaderboard.mjs, src/lib/jev/leaderboard.ts) already uses — no
 * second, divergent scoring implementation. This mirrors
 * otsone/laya_mlx/eval_external.py's two engines (HttpEngine /
 * AnswersFileEngine), ported to TypeScript so the capability lives in the
 * real platform instead of a local CLI script.
 */

export type SubmissionSourceKind = "endpoint" | "answers";

export type QuestionTypeBreakdown = {
  qtype: "choice" | "noul" | "score";
  case_count: number;
  accuracy: number;
  avg_confidence: number;
  ece: number;
  adaptive_ece: number;
  mce: number;
  brier: number;
  nll: number;
};

export type SubmissionResult = {
  case_count: number;
  accuracy: number;
  strict_pass_rate: number;
  avg_confidence: number;
  ece: number;
  adaptive_ece: number;
  mce: number;
  brier: number;
  nll: number;
  by_type: QuestionTypeBreakdown[];
};

export class BenchmarkSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkSubmissionError";
  }
}

function isAnswer(value: unknown): value is Answer {
  if (!value || typeof value !== "object") return false;
  const t = (value as { type?: unknown }).type;
  return t === "choice" || t === "noul" || t === "score";
}

/**
 * Normalize an uploaded answers payload into a gold-case-id -> (question-id ->
 * Answer) map, matching either shape a submitter is likely to produce (a flat
 * `{"<case id>": {<answers>}}` map, or `[{id, answers}, ...]`). Throws
 * `BenchmarkSubmissionError` listing any missing gold case id, same behavior
 * as `load_answers_payload` in otsone/laya_mlx/eval_external.py.
 */
export function parseAnswersPayload(raw: unknown): Record<string, Record<string, Answer>> {
  let byId: Record<string, unknown>;
  if (Array.isArray(raw)) {
    byId = {};
    raw.forEach((row, i) => {
      if (!row || typeof row !== "object" || !("id" in row) || !("answers" in row)) {
        throw new BenchmarkSubmissionError(
          `answers[${i}] must be an object with "id" and "answers" keys`,
        );
      }
      const { id, answers } = row as { id: unknown; answers: unknown };
      if (typeof id !== "string") {
        throw new BenchmarkSubmissionError(`answers[${i}].id must be a string`);
      }
      byId[id] = answers;
    });
  } else if (raw && typeof raw === "object") {
    byId = raw as Record<string, unknown>;
  } else {
    throw new BenchmarkSubmissionError(
      'answers must be a JSON object ({"<case id>": {<answers>}}) or an array of {id, answers} records',
    );
  }

  const missing = GOLD.filter((g) => !(g.id in byId)).map((g) => g.id);
  if (missing.length > 0) {
    throw new BenchmarkSubmissionError(
      `answers is missing ${missing.length} gold case id(s): ${missing.slice(0, 10).join(", ")}` +
        (missing.length > 10 ? ", ..." : ""),
    );
  }

  const perCaseAnswers: Record<string, Record<string, Answer>> = {};
  for (const g of GOLD) {
    const perCase = byId[g.id] as Record<string, unknown> | undefined;
    if (!perCase || typeof perCase !== "object") {
      throw new BenchmarkSubmissionError(`answers["${g.id}"] must be an object`);
    }
    for (const [qid, a] of Object.entries(perCase)) {
      if (!isAnswer(a)) {
        throw new BenchmarkSubmissionError(
          `answers["${g.id}"]["${qid}"] must have a "type" of "choice", "noul", or "score"`,
        );
      }
    }
    perCaseAnswers[g.id] = perCase as Record<string, Answer>;
  }
  return perCaseAnswers;
}

export type Runner = (req: SystemOneRequest) => Promise<SystemOneResponse | null>;

/**
 * Build a Runner that replays precomputed per-case answers, walking `GOLD` in
 * its own fixed order — the exact order `evalGoldWith` (gold.ts) iterates in,
 * so this never needs the case id `evalGoldWith`'s runner signature doesn't
 * pass it. Mirrors `AnswersFileEngine` in otsone/laya_mlx/eval_external.py.
 */
export function answersRunner(perCaseAnswers: Record<string, Record<string, Answer>>): Runner {
  let i = 0;
  return async (): Promise<SystemOneResponse | null> => {
    const g = GOLD[i];
    i += 1;
    if (!g) return null;
    const answers = perCaseAnswers[g.id];
    if (!answers) return null;
    return {
      model: "external-answers",
      answers,
      usage: { input_tokens: 0, output_tokens: 0 },
      latency_ms: 0,
    };
  };
}

/**
 * Build a Runner that POSTs `{state, questions}` to `url` and expects back
 * `{answers}` — the same contract `HttpEngine` in
 * otsone/laya_mlx/eval_external.py expects from a third-party endpoint. The
 * caller is responsible for validating `url` through the SSRF guard
 * (outbound-guard.server.ts) before calling this — this function makes no
 * safety decision about the URL itself, only shapes the HTTP call.
 */
export function endpointRunner(url: string, timeoutMs: number): Runner {
  return async (req: SystemOneRequest): Promise<SystemOneResponse | null> => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: req.state, questions: req.questions }),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const json: unknown = await res.json().catch(() => null);
      if (!json || typeof json !== "object" || !("answers" in json)) return null;
      const answers = (json as { answers: unknown }).answers;
      if (!answers || typeof answers !== "object") return null;
      return {
        model: "external-endpoint",
        answers: answers as Record<string, Answer>,
        usage: { input_tokens: 0, output_tokens: 0 },
        latency_ms: 0,
      };
    } catch {
      return null;
    }
  };
}

export const MIN_TIMEOUT_MS = 1_000;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_TIMEOUT_MS = 60_000;

/** Clamp a caller-supplied timeout (ms) to a sane range, defaulting when unset. */
export function clampTimeout(ms: number | undefined): number {
  if (!Number.isFinite(ms) || !ms) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(ms as number)));
}

/** Per-question-type reliability, reusing the same `buildReliability` engine
 * every other backend's calibration numbers come from (no separate math). */
export function byTypeBreakdown(predictions: readonly CalPrediction[]): QuestionTypeBreakdown[] {
  const types: Array<"choice" | "noul" | "score"> = ["choice", "noul", "score"];
  const out: QuestionTypeBreakdown[] = [];
  for (const qtype of types) {
    const subset = predictions.filter((p) => p.qtype === qtype);
    if (subset.length === 0) continue;
    const rep: CalibrationReport = buildReliability(subset);
    out.push({
      qtype,
      case_count: subset.length,
      accuracy: rep.overallAccuracy,
      avg_confidence: rep.avgConfidence,
      ece: rep.ece,
      adaptive_ece: rep.adaptiveEce,
      mce: rep.mce,
      brier: rep.brier,
      nll: rep.nll,
    });
  }
  return out;
}

/** Turn a full `GoldReport` (from `evalGoldWith`) into the persisted/returned
 * submission result shape: the overall numbers plus the per-type breakdown. */
export function toSubmissionResult(report: GoldReport): SubmissionResult {
  const strictTotal = report.passed + report.failed;
  return {
    case_count: report.caseCount,
    accuracy: report.calibration.overallAccuracy,
    strict_pass_rate: strictTotal ? report.passed / strictTotal : 0,
    avg_confidence: report.calibration.avgConfidence,
    ece: report.calibration.ece,
    adaptive_ece: report.calibration.adaptiveEce,
    mce: report.calibration.mce,
    brier: report.calibration.brier,
    nll: report.calibration.nll,
    by_type: byTypeBreakdown(report.predictions),
  };
}
