import { getSql } from "@/lib/db";
import { assertSafeOutboundUrl, isValidOutboundUrl } from "./outbound-guard.server.ts";
import { evalGoldWith, GOLD, type GoldReport } from "./gold.ts";
import {
  answersRunner,
  BenchmarkSubmissionError,
  clampTimeout,
  endpointRunner,
  parseAnswersPayload,
  toSubmissionResult,
  type QuestionTypeBreakdown,
  type Runner,
  type SubmissionResult,
  type SubmissionSourceKind,
} from "./benchmark-scoring.ts";
import type { Answer } from "./types.ts";

export { BenchmarkSubmissionError, type SubmissionSourceKind, type SubmissionResult };

/**
 * DB-backed, user-scoped wrapper around the pure scoring logic in
 * benchmark-scoring.ts. See that file's header for the full design note on
 * why this capability reuses the real gold suite + calibration engine
 * instead of a second implementation.
 *
 * Runs synchronously inside the request (same pattern as `createEvalRun` in
 * evals.server.ts): there is no background job queue in this app, so the
 * whole gold suite (93 cases) is scored before the API responds. For an
 * "endpoint" submission that is up to 93 sequential HTTP round trips to the
 * submitter's server — seconds, not hours, but a known, documented
 * limitation (see otsone/hackathons/geekroom-2026/HACKATHON-SUBMISSION.md)
 * rather than a hidden one.
 */

export type BenchmarkSubmission = {
  id: string;
  user_id: string;
  model_label: string;
  source_kind: SubmissionSourceKind;
  endpoint_url: string | null;
  status: "pending" | "running" | "completed" | "failed";
  error_message: string | null;
  case_count: number;
  submitted_at: number; // epoch millis
  completed_at: number | null; // epoch millis
  result?: SubmissionResult | null;
};

/** Request body accepted by POST /api/v1/benchmark-submissions. */
export type CreateSubmissionInput = {
  userId: string;
  modelLabel: string;
  sourceKind: SubmissionSourceKind;
  endpointUrl?: string;
  /** `{"<gold case id>": {<answers>}, ...}` or `[{id, answers}, ...]`. */
  answers?: unknown;
  /** Extra HTTP timeout for each endpoint call, in ms (default 15000, max 60000). */
  timeoutMs?: number;
};

function suffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Create a submission, validate its source, run the full gold suite through
 * it (via the shared engine), and persist both the submission row and its
 * overall + per-question-type results. Returns the completed (or failed)
 * submission — there is no separate "poll for status" step because the run
 * happens inline.
 */
export async function createSubmission(
  input: CreateSubmissionInput,
): Promise<BenchmarkSubmission> {
  const modelLabel = input.modelLabel.trim();
  if (!modelLabel) throw new BenchmarkSubmissionError("modelLabel is required");
  if (modelLabel.length > 120) {
    throw new BenchmarkSubmissionError("modelLabel must be 120 characters or fewer");
  }

  let runner: Runner;
  let endpointUrl: string | null = null;
  let answersJson: Record<string, Record<string, Answer>> | null = null;

  if (input.sourceKind === "endpoint") {
    const url = input.endpointUrl?.trim();
    if (!url || !isValidOutboundUrl(url)) {
      throw new BenchmarkSubmissionError(
        "endpointUrl must be a public http(s) URL (not localhost/private/link-local)",
      );
    }
    await assertSafeOutboundUrl(url);
    endpointUrl = url;
    runner = endpointRunner(url, clampTimeout(input.timeoutMs));
  } else if (input.sourceKind === "answers") {
    answersJson = parseAnswersPayload(input.answers);
    runner = answersRunner(answersJson);
  } else {
    throw new BenchmarkSubmissionError('sourceKind must be "endpoint" or "answers"');
  }

  const sql = await getSql();
  const id = `bmk_${Date.now().toString(36)}${suffix()}`;
  await sql.query(
    `insert into benchmark_submissions
       (id, user_id, model_label, source_kind, endpoint_url, answers_json, status, case_count)
     values ($1, $2, $3, $4, $5, $6::jsonb, 'running', $7)`,
    [
      id,
      input.userId,
      modelLabel,
      input.sourceKind,
      endpointUrl,
      answersJson ? JSON.stringify(answersJson) : null,
      GOLD.length,
    ],
  );

  let report: GoldReport;
  try {
    report = await evalGoldWith(runner);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Evaluation failed";
    await sql.query(
      `update benchmark_submissions
         set status = 'failed', error_message = $2, completed_at = now()
       where id = $1`,
      [id, message],
    );
    return (await getSubmission(input.userId, id)) as BenchmarkSubmission;
  }

  const result = toSubmissionResult(report);
  await sql.query(
    `insert into benchmark_results
       (id, submission_id, qtype, case_count, accuracy, strict_pass_rate,
        avg_confidence, ece, adaptive_ece, mce, brier, nll)
     values ($1, $2, 'overall', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      `${id}_overall`,
      id,
      result.case_count,
      result.accuracy,
      result.strict_pass_rate,
      result.avg_confidence,
      result.ece,
      result.adaptive_ece,
      result.mce,
      result.brier,
      result.nll,
    ],
  );
  for (const t of result.by_type) {
    await sql.query(
      `insert into benchmark_results
         (id, submission_id, qtype, case_count, accuracy, strict_pass_rate,
          avg_confidence, ece, adaptive_ece, mce, brier, nll)
       values ($1, $2, $3, $4, $5, null, $6, $7, $8, $9, $10, $11)`,
      [
        `${id}_${t.qtype}`,
        id,
        t.qtype,
        t.case_count,
        t.accuracy,
        t.avg_confidence,
        t.ece,
        t.adaptive_ece,
        t.mce,
        t.brier,
        t.nll,
      ],
    );
  }
  await sql.query(
    `update benchmark_submissions set status = 'completed', completed_at = now() where id = $1`,
    [id],
  );

  return (await getSubmission(input.userId, id)) as BenchmarkSubmission;
}

type SubmissionRow = {
  id: string;
  user_id: string;
  model_label: string;
  source_kind: SubmissionSourceKind;
  endpoint_url: string | null;
  status: BenchmarkSubmission["status"];
  error_message: string | null;
  case_count: number;
  submitted_at: number;
  completed_at: number | null;
};

const SUBMISSION_COLS = `
  id, user_id, model_label, source_kind, endpoint_url, status, error_message, case_count,
  (extract(epoch from submitted_at) * 1000)::bigint as submitted_at,
  (extract(epoch from completed_at) * 1000)::bigint as completed_at`;

async function attachResult(row: SubmissionRow): Promise<BenchmarkSubmission> {
  if (row.status !== "completed") return { ...row, result: null };
  const sql = await getSql();
  const results = await sql.query<{
    qtype: string;
    case_count: number;
    accuracy: number | null;
    strict_pass_rate: number | null;
    avg_confidence: number | null;
    ece: number | null;
    adaptive_ece: number | null;
    mce: number | null;
    brier: number | null;
    nll: number | null;
  }>(
    `select qtype, case_count, accuracy, strict_pass_rate, avg_confidence,
            ece, adaptive_ece, mce, brier, nll
     from benchmark_results where submission_id = $1`,
    [row.id],
  );
  const overall = results.find((r) => r.qtype === "overall");
  const byType: QuestionTypeBreakdown[] = results
    .filter((r) => r.qtype !== "overall")
    .map((r) => ({
      qtype: r.qtype as QuestionTypeBreakdown["qtype"],
      case_count: r.case_count,
      accuracy: r.accuracy ?? 0,
      avg_confidence: r.avg_confidence ?? 0,
      ece: r.ece ?? 0,
      adaptive_ece: r.adaptive_ece ?? 0,
      mce: r.mce ?? 0,
      brier: r.brier ?? 0,
      nll: r.nll ?? 0,
    }));
  if (!overall) return { ...row, result: null };
  return {
    ...row,
    result: {
      case_count: overall.case_count,
      accuracy: overall.accuracy ?? 0,
      strict_pass_rate: overall.strict_pass_rate ?? 0,
      avg_confidence: overall.avg_confidence ?? 0,
      ece: overall.ece ?? 0,
      adaptive_ece: overall.adaptive_ece ?? 0,
      mce: overall.mce ?? 0,
      brier: overall.brier ?? 0,
      nll: overall.nll ?? 0,
      by_type: byType,
    },
  };
}

/** One submission (scoped to the user), with its result when completed. */
export async function getSubmission(
  userId: string,
  id: string,
): Promise<BenchmarkSubmission | null> {
  const sql = await getSql();
  const rows = await sql.query<SubmissionRow>(
    `select ${SUBMISSION_COLS} from benchmark_submissions where id = $1 and user_id = $2`,
    [id, userId],
  );
  if (rows.length === 0) return null;
  return attachResult(rows[0]);
}

/** A user's submissions, newest first. */
export async function listSubmissions(userId: string, limit = 50): Promise<BenchmarkSubmission[]> {
  const sql = await getSql();
  const rows = await sql.query<SubmissionRow>(
    `select ${SUBMISSION_COLS} from benchmark_submissions
     where user_id = $1
     order by submitted_at desc
     limit $2`,
    [userId, Math.min(Math.max(limit, 1), 200)],
  );
  return Promise.all(rows.map(attachResult));
}

/**
 * Every completed submission across all users, for the public leaderboard —
 * only the fields the leaderboard table needs (no endpoint URLs, no raw
 * answers payloads, no user id). Newest first, capped at `limit`.
 */
export async function listPublicLeaderboardSubmissions(
  limit = 100,
): Promise<Array<{ id: string; model_label: string; submitted_at: number; result: SubmissionResult }>> {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string;
    model_label: string;
    submitted_at: number;
    r_case_count: number;
    r_accuracy: number | null;
    r_strict_pass_rate: number | null;
    r_avg_confidence: number | null;
    r_ece: number | null;
    r_adaptive_ece: number | null;
    r_mce: number | null;
    r_brier: number | null;
    r_nll: number | null;
  }>(
    `select s.id, s.model_label,
            (extract(epoch from s.submitted_at) * 1000)::bigint as submitted_at,
            r.case_count as r_case_count, r.accuracy as r_accuracy,
            r.strict_pass_rate as r_strict_pass_rate, r.avg_confidence as r_avg_confidence,
            r.ece as r_ece, r.adaptive_ece as r_adaptive_ece, r.mce as r_mce,
            r.brier as r_brier, r.nll as r_nll
     from benchmark_submissions s
     join benchmark_results r on r.submission_id = s.id and r.qtype = 'overall'
     where s.status = 'completed'
     order by s.submitted_at desc
     limit $1`,
    [Math.min(Math.max(limit, 1), 500)],
  );
  return rows.map((r) => ({
    id: r.id,
    model_label: r.model_label,
    submitted_at: r.submitted_at,
    result: {
      case_count: r.r_case_count,
      accuracy: r.r_accuracy ?? 0,
      strict_pass_rate: r.r_strict_pass_rate ?? 0,
      avg_confidence: r.r_avg_confidence ?? 0,
      ece: r.r_ece ?? 0,
      adaptive_ece: r.r_adaptive_ece ?? 0,
      mce: r.r_mce ?? 0,
      brier: r.r_brier ?? 0,
      nll: r.r_nll ?? 0,
      by_type: [],
    },
  }));
}
