import { getSql } from "@/lib/db";
import { executeSystemOne } from "./run";
import { getDecision } from "./decisions.server";
import { GOLD, type GoldExpect } from "./gold";
import { resolveModel } from "./models";
import { engineIdOf, type EngineId } from "./engine-id";
import type {
  Answer,
  ChoiceAnswer,
  NoulAnswer,
  Questions,
  ScoreAnswer,
  State,
} from "./types";

/**
 * DB-backed, user-scoped evaluation runs (Foundation-2). An eval run executes a
 * batch of cases against the real System One engine (`executeSystemOne`) on a
 * chosen model/backend, checks each case's expectations, and persists the run
 * plus its per-case results. The built-in "gold" suite is the shipped
 * calibration set (src/lib/jev/gold.ts). Scoped to a server-resolved `userId`.
 */

/** One case to evaluate. `questions` defaults to a decision's / the gold set's. */
export type EvalCaseInput = {
  name: string;
  state: State;
  questions?: Questions;
  expect: GoldExpect[];
};

/** A persisted case result. `expected` is the assertion set; `got` the answers. */
export type EvalCaseResult = {
  id: string;
  name: string;
  pass: boolean;
  expected: GoldExpect[];
  got: Record<string, Answer>;
  /** The case input, kept so a calibration fitted from the run can be re-fitted. */
  state?: State | null;
  questions?: Questions | null;
};

/** An eval run summary row. Timestamps are epoch millis. */
export type EvalRun = {
  id: string;
  decision_id: string | null;
  backend: string;
  model: string;
  total: number;
  passed: number;
  failed: number;
  created_at: number;
  /** Engine that answered the run (null on runs recorded before tracking). */
  engine_kind?: string | null;
  engine_version?: string | null;
};

export type EvalRunDetail = EvalRun & { cases: EvalCaseResult[] };

/** Options for `createEvalRun`. With no `cases`, the gold suite is run. */
export type CreateEvalRunInput = {
  userId: string;
  decisionId?: string | null;
  model?: string;
  backend?: string;
  suite?: "gold" | "custom";
  cases?: EvalCaseInput[];
};

function suffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/**
 * Check a case's answers against its expectations. A case passes only when every
 * assertion holds. Mirrors the assertion logic in gold.ts (`evalGold`).
 */
function checkExpectations(
  answers: Record<string, Answer>,
  expect: GoldExpect[],
): boolean {
  for (const exp of expect) {
    if (exp.choice) {
      const a = answers[exp.choice.id] as ChoiceAnswer | undefined;
      const ok =
        a?.type === "choice" &&
        a.choice === exp.choice.value &&
        (exp.choice.minP == null ||
          (a.probabilities[exp.choice.value] ?? 0) >= exp.choice.minP);
      if (!ok) return false;
    }
    if (exp.noul) {
      const a = answers[exp.noul.id] as NoulAnswer | undefined;
      const v = a?.noul ?? -1;
      const ok =
        a?.type === "noul" &&
        (exp.noul.min == null || v >= exp.noul.min) &&
        (exp.noul.max == null || v <= exp.noul.max);
      if (!ok) return false;
    }
    if (exp.score) {
      const a = answers[exp.score.id] as ScoreAnswer | undefined;
      const v = a?.score ?? -1;
      const ok = a?.type === "score" && v >= exp.score.min && v <= exp.score.max;
      if (!ok) return false;
    }
  }
  return true;
}

/** The shipped gold calibration set, mapped to eval cases. */
function goldCases(): EvalCaseInput[] {
  return GOLD.map((g) => ({
    name: g.id,
    state: g.state,
    questions: g.questions,
    expect: g.expect,
  }));
}

/**
 * Execute a batch of cases against the real engine and persist the run + cases.
 * When `cases` is omitted the gold suite runs; when a `decisionId` is given, any
 * case lacking its own `questions` inherits the decision's schema.
 */
export async function createEvalRun(
  input: CreateEvalRunInput,
): Promise<EvalRunDetail> {
  const { userId } = input;
  const resolved = resolveModel(input.model);
  const model = resolved.id;
  const backend = input.backend?.trim() || resolved.backend;

  // Optional decision context: supplies a default questions schema.
  let decisionQuestions: Questions | null = null;
  const decisionId = input.decisionId ?? null;
  if (decisionId) {
    const decision = await getDecision(userId, decisionId);
    if (decision) decisionQuestions = decision.questions;
  }

  const cases =
    input.cases && input.cases.length > 0 ? input.cases : goldCases();

  const results: EvalCaseResult[] = [];
  let engine: EngineId | null = null;
  for (const c of cases) {
    const questions = c.questions ?? decisionQuestions ?? {};
    const expect = Array.isArray(c.expect) ? c.expect : [];
    const response = await executeSystemOne(
      { model, state: c.state, questions },
      { path: "/api/v1/evals" },
    );
    const got = response.answers;
    const pass = checkExpectations(got, expect);
    // For `auto` the recorded engine is the local tier's (what a calibration
    // fitted from this run is applied to).
    engine ??= engineIdOf(
      response.escalation ? { ...response, model: response.escalation.local_model } : response,
    );
    results.push({
      id: `case_${Date.now().toString(36)}${suffix()}`,
      name: c.name,
      pass,
      expected: expect,
      got,
      state: c.state,
      questions,
    });
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;

  const sql = await getSql();
  const runId = `run_${Date.now().toString(36)}${suffix()}`;
  await sql.query(
    `insert into eval_runs
       (id, user_id, decision_id, backend, model, total, passed, failed,
        engine_kind, engine_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      runId,
      userId,
      decisionId,
      backend,
      model,
      results.length,
      passed,
      failed,
      engine?.kind ?? null,
      engine?.version ?? null,
    ],
  );
  for (const r of results) {
    await sql.query(
      `insert into eval_cases (id, run_id, name, expected, got, pass, state_json, questions_json)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8::jsonb)`,
      [
        r.id,
        runId,
        r.name,
        JSON.stringify(r.expected),
        JSON.stringify(r.got),
        r.pass,
        JSON.stringify(r.state ?? null),
        JSON.stringify(r.questions ?? null),
      ],
    );
  }

  const createdRows = await sql.query<{ created_at: number }>(
    `select (extract(epoch from created_at) * 1000)::bigint as created_at
     from eval_runs where id = $1`,
    [runId],
  );

  return {
    id: runId,
    decision_id: decisionId,
    backend,
    model,
    total: results.length,
    passed,
    failed,
    created_at: createdRows[0]?.created_at ?? Date.now(),
    engine_kind: engine?.kind ?? null,
    engine_version: engine?.version ?? null,
    cases: results,
  };
}

/** A user's eval runs, newest first (default 50, max 200). */
export async function listEvalRuns(opts: {
  userId: string;
  limit?: number;
}): Promise<EvalRun[]> {
  const sql = await getSql();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return sql.query<EvalRun>(
    `select id, decision_id, backend, model, total, passed, failed,
            engine_kind, engine_version,
            (extract(epoch from created_at) * 1000)::bigint as created_at
     from eval_runs
     where user_id = $1
     order by created_at desc
     limit $2`,
    [opts.userId, limit],
  );
}

/** One eval run with its cases (scoped to the user), or null. */
export async function getEvalRun(
  userId: string,
  id: string,
): Promise<EvalRunDetail | null> {
  const sql = await getSql();
  const runs = await sql.query<EvalRun>(
    `select id, decision_id, backend, model, total, passed, failed,
            engine_kind, engine_version,
            (extract(epoch from created_at) * 1000)::bigint as created_at
     from eval_runs
     where id = $1 and user_id = $2`,
    [id, userId],
  );
  if (runs.length === 0) return null;

  const caseRows = await sql.query<{
    id: string;
    name: string;
    expected: unknown;
    got: unknown;
    pass: boolean;
    state_json: unknown;
    questions_json: unknown;
  }>(
    `select c.id, c.name, c.expected, c.got, c.pass, c.state_json, c.questions_json
     from eval_cases c
     join eval_runs r on r.id = c.run_id
     where c.run_id = $1 and r.user_id = $2
     order by c.pass asc, c.id`,
    [id, userId],
  );

  const cases: EvalCaseResult[] = caseRows.map((r) => ({
    id: r.id,
    name: r.name,
    pass: r.pass,
    expected: parseJson<GoldExpect[]>(r.expected, []),
    got: parseJson<Record<string, Answer>>(r.got, {}),
    state: parseJson<State | null>(r.state_json, null),
    questions: parseJson<Questions | null>(r.questions_json, null),
  }));

  return { ...runs[0], cases };
}
