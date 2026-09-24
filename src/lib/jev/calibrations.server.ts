import { getSql } from "@/lib/db";
import {
  POOLED_KEY,
  applyCalibrationMap,
  calibrationDelta,
  fitQuestion,
  MIN_HELDOUT_FOR_CURVE,
  MIN_SAMPLES_PER_QUESTION,
  pickThreshold,
  splitTrainHeldout,
  thresholdCurve,
  type CalibrationMaps,
  type CalibrationMethod,
  type CalibrationMethodChoice,
  type CalSample,
  type ThresholdPoint,
} from "./calibration-fit";
import { getEvalRun } from "./evals.server";
import { gradeAnswer, LabelError, normalizeLabel, type LabelValue } from "./labels";
import { resolveModel, DEFAULT_MODEL } from "./models";
import { serveSystemOne } from "./run";
import { evalRunSamples, type GradedCase } from "./eval-samples";
import { GOLD } from "./gold";
import {
  calibrationEngineMismatch,
  engineIdOf,
  LEXICAL_ENGINE_VERSION,
  sameEngine,
  type EngineId,
  type EngineKind,
} from "./engine-id";
import type { Questions, State } from "./types";
import { JevValidationError, validateRequest } from "./validate";

/**
 * Per-customer calibration (trust layer P1.1). A customer uploads labelled
 * examples (or points at an eval run); each example is answered by the chosen
 * model, graded against its label, and a per-question map is fitted. The map is
 * stored in `calibration_maps` and applied at inference when a request passes
 * `calibration_id` (see run.ts). Every read/write is scoped to `userId`.
 */

/** Upload limits: enough for a real fit, bounded so a request stays fast. */
export const MAX_EXAMPLES = 2000;
export const DEFAULT_TARGET_PRECISION = 0.95;

export type CalibrationExample = {
  state: State;
  labels: Record<string, unknown>;
};

/** One eval-run case input, snapshotted onto a calibration fitted from the run. */
export type StoredEvalCase = {
  name: string;
  state: State;
  questions: Questions;
  expected: GradedCase["expected"];
};

/**
 * What `calibration_maps.examples_json` holds: the labelled INPUTS a map was
 * fitted on, so it can be re-fitted when the serving engine changes.
 *  - upload path: the array of `{ state, labels }` examples (original shape);
 *  - eval-run path: `{ eval_cases: [...] }`, a snapshot of the run's case
 *    inputs + expectations, so a re-fit does not depend on the run row.
 */
type StoredInputs =
  | { kind: "examples"; examples: CalibrationExample[] }
  | { kind: "eval_cases"; cases: StoredEvalCase[] }
  | { kind: "none" };

function parseStoredInputs(value: unknown): StoredInputs {
  const raw = parseJson<unknown>(value, null);
  if (Array.isArray(raw) && raw.length > 0) {
    return { kind: "examples", examples: raw as CalibrationExample[] };
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as { eval_cases?: unknown }).eval_cases)) {
    const cases = (raw as { eval_cases: StoredEvalCase[] }).eval_cases;
    if (cases.length > 0) return { kind: "eval_cases", cases };
  }
  return { kind: "none" };
}

export type QuestionMetrics = {
  n: number;
  method: CalibrationMethod;
  /**
   * How before/after were measured. "held_out": the map was fitted on the
   * train slice and before/after are measured on labels it never saw.
   * "in_sample": too few labels to hold any out, so the numbers are optimistic.
   * Absent on calibrations created before held-out evaluation existed.
   */
  evaluation?: "held_out" | "in_sample";
  train_n?: number;
  heldout_n?: number;
  before: { accuracy: number; ece: number; brier: number; avgConfidence: number };
  after: { accuracy: number; ece: number; brier: number; avgConfidence: number };
  /** Coverage/precision curve on the CALIBRATED confidences. */
  curve: ThresholdPoint[];
  /** Which samples the curve was drawn on. */
  curve_on?: "held_out" | "all_labels";
  /** Lowest threshold reaching the target precision, or null. */
  recommended: ThresholdPoint | null;
  target_precision: number;
};

export type CalibrationSummary = {
  id: string;
  name: string;
  model: string;
  method: CalibrationMethodChoice;
  source: "upload" | "eval_run";
  eval_run_id: string | null;
  sample_count: number;
  question_ids: string[];
  created_at: number;
  /** When the maps were last (re)fitted (epoch ms). */
  fitted_at: number;
  refit_count: number;
  /** Engine the maps were fitted on; null when it was not recorded. */
  engine: EngineId | null;
  /** Engine this deployment serves `model` with right now. */
  engine_current: EngineId;
  /**
   * Why the map will NOT be applied on this deployment (fitted engine differs
   * from the serving engine), or null when it applies. Re-fit to clear it.
   */
  engine_mismatch: string | null;
  /** Whether a re-fit can run without new uploads (labelled inputs are stored). */
  refit_available: boolean;
  refit_unavailable_reason: string | null;
};

export type CalibrationDetail = CalibrationSummary & {
  questions: Questions;
  maps: CalibrationMaps;
  metrics: Record<string, QuestionMetrics>;
  /** Questions that had too few labels to fit (left uncalibrated). */
  skipped: Record<string, string>;
};

export type CreateCalibrationInput = {
  userId: string;
  name: string;
  model?: string;
  method?: CalibrationMethodChoice;
  targetPrecision?: number;
  /** Upload path: schema + labelled examples. */
  questions?: unknown;
  examples?: unknown;
  /** Eval-run path: fit from an existing eval run's graded cases. */
  evalRunId?: string;
};

function newId(): string {
  return `cal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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

function bad(message: string): never {
  throw new JevValidationError("invalid_calibration", message);
}

/** Strip trust knobs so fitting sees the model's raw answers. */
function rawQuestions(questions: Questions): Questions {
  const out: Questions = {};
  for (const [id, q] of Object.entries(questions)) {
    const { abstain: _a, abstain_below: _b, escalate_below: _e, ...rest } = q;
    out[id] = rest as typeof q;
  }
  return out;
}

function assertCalibratableModel(model: string | undefined): string {
  const resolved = resolveModel(model);
  if (resolved.backend === "auto" || resolved.backend === "llm") {
    bad(
      "Calibrate a concrete local or neural model (e.g. system-one, otsone-1, laya-onnx). " +
        "The auto cascade applies a calibration fitted on its local tier.",
    );
  }
  return resolved.id;
}

/** Graded samples per question id from the upload path. */
async function samplesFromUpload(
  model: string,
  questionsRaw: unknown,
  examplesRaw: unknown,
): Promise<{
  questions: Questions;
  samples: Record<string, CalSample[]>;
  served: string;
  engine: EngineId | null;
  examples: CalibrationExample[];
}> {
  const questions = rawQuestions(validateRequest({ state: "-", questions: questionsRaw }).questions);
  if (!Array.isArray(examplesRaw) || examplesRaw.length === 0) {
    bad("`examples` must be a non-empty array of { state, labels }.");
  }
  if (examplesRaw.length > MAX_EXAMPLES) {
    bad(`At most ${MAX_EXAMPLES} examples per calibration.`);
  }
  const samples: Record<string, CalSample[]> = {};
  for (const id of Object.keys(questions)) samples[id] = [];
  const answer = answerer(model);
  const kept: CalibrationExample[] = [];

  for (let i = 0; i < examplesRaw.length; i++) {
    const ex = examplesRaw[i] as Partial<CalibrationExample> | null;
    if (!ex || typeof ex !== "object" || ex.state == null || typeof ex.labels !== "object" || !ex.labels) {
      bad(`examples[${i}] must be { state, labels }.`);
    }
    const labels: Record<string, LabelValue> = {};
    for (const [qid, raw] of Object.entries(ex.labels)) {
      const q = questions[qid];
      if (!q) bad(`examples[${i}].labels.${qid} is not a question in the schema.`);
      try {
        labels[qid] = normalizeLabel(qid, q, raw);
      } catch (err) {
        if (err instanceof LabelError) bad(`examples[${i}]: ${err.message}`);
        throw err;
      }
    }
    if (Object.keys(labels).length === 0) continue;
    kept.push({ state: ex.state, labels: ex.labels });
    const answers = await answer.run(ex.state, questions);
    for (const [qid, label] of Object.entries(labels)) {
      const a = answers[qid];
      if (a) samples[qid]!.push(gradeAnswer(a, label));
    }
  }
  return { questions, samples, served: answer.served(), engine: answer.engine(), examples: kept };
}

/**
 * Answers inputs on one model and tracks which engine answered. Fitting a map
 * across two engines (e.g. the encoder failed half-way and the lexical engine
 * took over) would describe neither, so a mid-fit engine change is an error.
 */
function answerer(model: string) {
  let served = model;
  let engine: EngineId | null = null;
  return {
    async run(state: State, questions: Questions) {
      const req = validateRequest({ model, state, questions });
      const out = await serveSystemOne(req, { calibrate: false });
      const e = engineIdOf(out);
      if (engine && !sameEngine(engine, e)) {
        bad(
          `The serving engine changed during the fit (${engine.kind} ${engine.version} → ` +
            `${e.kind} ${e.version}). Check GET /api/v1/status and try again.`,
        );
      }
      engine = e;
      served = out.model;
      return out.answers;
    },
    served: () => served,
    engine: () => engine,
  };
}

/** Rebuild a stored eval case's input: stored state, else the gold case by name. */
function evalCaseInput(
  c: { name: string; state?: State | null; questions?: Questions | null },
): { state: State; questions: Questions } | null {
  if (c.state != null && c.questions) return { state: c.state, questions: c.questions };
  const gold = GOLD.find((g) => g.id === c.name);
  return gold ? { state: gold.state, questions: gold.questions } : null;
}

/**
 * Graded samples from an eval run: each case's stored answers are graded
 * against its expectations (choice value, noul side, score band midpoint).
 */
async function samplesFromEvalRun(
  userId: string,
  runId: string,
): Promise<{
  model: string;
  questions: Questions;
  samples: Record<string, CalSample[]>;
  engine: EngineId | null;
  /** Case inputs to store with the map; null when any case has no stored input. */
  inputs: StoredEvalCase[] | null;
}> {
  const run = await getEvalRun(userId, runId);
  if (!run) bad(`Eval run ${runId} was not found for this account.`);
  const engine =
    run.engine_kind && run.engine_version
      ? { kind: run.engine_kind as EngineKind, version: run.engine_version }
      : null;
  const inputs: StoredEvalCase[] = [];
  for (const c of run.cases) {
    const input = evalCaseInput(c);
    if (!input) break;
    inputs.push({ name: c.name, state: input.state, questions: input.questions, expected: c.expected });
  }
  return {
    model: run.model,
    questions: {},
    samples: evalRunSamples(run.cases),
    engine,
    inputs: inputs.length === run.cases.length && inputs.length > 0 ? inputs : null,
  };
}

/** Re-answer stored eval-case inputs on the CURRENT engine and grade them. */
async function samplesFromStoredCases(
  cases: readonly StoredEvalCase[],
  model: string,
): Promise<{ samples: Record<string, CalSample[]>; served: string; engine: EngineId | null }> {
  const answer = answerer(model);
  const graded: GradedCase[] = [];
  for (const c of cases) {
    graded.push({ expected: c.expected, got: await answer.run(c.state, c.questions) });
  }
  return { samples: evalRunSamples(graded), served: answer.served(), engine: answer.engine() };
}

/**
 * Re-answer an eval run's cases on the CURRENT engine and grade them against
 * the run's expectations (the stored answers came from the engine the run
 * used, which is what a re-fit replaces).
 */
async function samplesFromEvalRunReanswered(
  userId: string,
  runId: string,
  model: string,
): Promise<{ samples: Record<string, CalSample[]>; served: string; engine: EngineId | null }> {
  const run = await getEvalRun(userId, runId);
  if (!run) bad(`Eval run ${runId} was not found for this account.`);
  const answer = answerer(model);
  const graded: GradedCase[] = [];
  let missing = 0;
  for (const c of run.cases) {
    const input = evalCaseInput(c);
    if (!input) {
      missing += 1;
      continue;
    }
    graded.push({ expected: c.expected, got: await answer.run(input.state, input.questions) });
  }
  if (graded.length === 0) {
    bad(
      `Eval run ${runId} was recorded before case inputs were stored, so it cannot be ` +
        "re-answered. Run the eval again and fit from the new run.",
    );
  }
  if (missing > 0) {
    bad(
      `${missing} of ${run.cases.length} cases in eval run ${runId} have no stored input. ` +
        "Run the eval again and fit from the new run.",
    );
  }
  return { samples: evalRunSamples(graded), served: answer.served(), engine: answer.engine() };
}

function metricsFor(
  qid: string,
  samples: CalSample[],
  methodChoice: CalibrationMethodChoice,
  targetPrecision: number,
  seed: string,
): { map: CalibrationMaps[string]; metrics: QuestionMetrics } {
  // Fit on the train slice, report on the held-out slice: the before/after
  // numbers describe labels the map never saw, so they are not optimistic.
  const split = splitTrainHeldout(samples, `${seed}:${qid}`);
  const map = fitQuestion(split.train, methodChoice);
  const { before, after } = calibrationDelta(qid, split.heldout, map);
  // Curve over CALIBRATED confidences (what a threshold compares against at
  // inference). Drawn on held-out when it is large enough to be stable.
  const curveOnHeldout = split.evaluation === "held_out" && split.heldout.length >= MIN_HELDOUT_FOR_CURVE;
  const curveSamples = curveOnHeldout ? split.heldout : samples;
  const curve = thresholdCurve(
    curveSamples.map((s) => ({ ...s, confidence: applyCalibrationMap(map, s.confidence) })),
  );
  const pick = (r: typeof before) => ({
    accuracy: r.overallAccuracy,
    ece: r.ece,
    brier: r.brier,
    avgConfidence: r.avgConfidence,
  });
  return {
    map,
    metrics: {
      n: samples.length,
      method: map.method,
      evaluation: split.evaluation,
      train_n: split.train.length,
      heldout_n: split.heldout.length,
      before: pick(before),
      after: pick(after),
      curve,
      curve_on: curveOnHeldout ? "held_out" : "all_labels",
      recommended: pickThreshold(curve, targetPrecision),
      target_precision: targetPrecision,
    },
  };
}

type Fitted = {
  maps: CalibrationMaps;
  metrics: Record<string, QuestionMetrics>;
  skipped: Record<string, string>;
  sampleCount: number;
};

/** Fit per-question maps (plus a pooled "*" fallback) from graded samples. */
function fitAll(
  samples: Record<string, CalSample[]>,
  method: CalibrationMethodChoice,
  target: number,
  seed: string,
): Fitted {
  const maps: CalibrationMaps = {};
  const metrics: Record<string, QuestionMetrics> = {};
  const skipped: Record<string, string> = {};
  let sampleCount = 0;
  for (const [qid, s] of Object.entries(samples)) {
    sampleCount += s.length;
    if (s.length < MIN_SAMPLES_PER_QUESTION) {
      skipped[qid] = `needs at least ${MIN_SAMPLES_PER_QUESTION} labels (got ${s.length})`;
      continue;
    }
    const fitted = metricsFor(qid, s, method, target, seed);
    maps[qid] = fitted.map;
    metrics[qid] = fitted.metrics;
  }
  // Pooled fallback map ("*"): questions with too few labels of their own are
  // calibrated with a map fitted on every label together, when there are enough.
  const pooled = Object.values(samples).flat();
  if (Object.keys(skipped).length > 0 && pooled.length >= MIN_SAMPLES_PER_QUESTION) {
    const fitted = metricsFor(POOLED_KEY, pooled, method, target, seed);
    maps[POOLED_KEY] = fitted.map;
    metrics[POOLED_KEY] = fitted.metrics;
  }
  if (Object.keys(maps).length === 0) {
    bad(
      `No question had enough labels to fit (minimum ${MIN_SAMPLES_PER_QUESTION} per question). ` +
        Object.entries(skipped)
          .map(([q, why]) => `${q}: ${why}`)
          .join("; "),
    );
  }
  return { maps, metrics, skipped, sampleCount };
}

/** Fit and persist a calibration. Throws JevValidationError on bad input. */
export async function createCalibration(input: CreateCalibrationInput): Promise<CalibrationDetail> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) bad("`name` is required.");
  if (name.length > 120) bad("`name` must be at most 120 characters.");
  const method: CalibrationMethodChoice = input.method ?? "auto";
  if (!["auto", "temperature", "isotonic"].includes(method)) {
    bad("`method` must be auto, temperature, or isotonic.");
  }
  const target = input.targetPrecision ?? DEFAULT_TARGET_PRECISION;
  if (typeof target !== "number" || !(target > 0 && target <= 1)) {
    bad("`target_precision` must be a number in (0, 1].");
  }

  let model: string;
  let questions: Questions;
  let samples: Record<string, CalSample[]>;
  let source: "upload" | "eval_run";
  let engine: EngineId | null;
  let storedInputs: CalibrationExample[] | { eval_cases: StoredEvalCase[] } | null = null;
  if (input.evalRunId) {
    const fromRun = await samplesFromEvalRun(input.userId, input.evalRunId);
    model = assertCalibratableModel(fromRun.model);
    questions = fromRun.questions;
    samples = fromRun.samples;
    engine = fromRun.engine;
    storedInputs = fromRun.inputs ? { eval_cases: fromRun.inputs } : null;
    source = "eval_run";
  } else {
    const requested = assertCalibratableModel(input.model);
    const up = await samplesFromUpload(requested, input.questions, input.examples);
    // Store the model that ACTUALLY answered (a sidecar model that fell back
    // to the local engine is fitted, and later applied, as the local engine).
    model = up.served;
    questions = up.questions;
    samples = up.samples;
    engine = up.engine;
    storedInputs = up.examples;
    source = "upload";
  }

  const id = newId();
  const fitted = fitAll(samples, method, target, id);

  const sql = await getSql();
  await sql.query(
    `insert into calibration_maps
       (id, user_id, name, model, method, source, eval_run_id,
        questions_json, maps_json, metrics_json, sample_count,
        engine_kind, engine_version, examples_json, fitted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11,
             $12, $13, $14::jsonb, now())`,
    [
      id,
      input.userId,
      name,
      model,
      method,
      source,
      input.evalRunId ?? null,
      JSON.stringify(questions),
      JSON.stringify(fitted.maps),
      JSON.stringify({ metrics: fitted.metrics, skipped: fitted.skipped }),
      fitted.sampleCount,
      engine?.kind ?? null,
      engine?.version ?? null,
      storedInputs ? JSON.stringify(storedInputs) : null,
    ],
  );
  const created = await getCalibration(input.userId, id);
  if (!created) throw new Error("Calibration was not persisted.");
  return created;
}

/** The target precision a calibration was fitted with (stored per question). */
function storedTarget(metrics: Record<string, QuestionMetrics>): number {
  const first = Object.values(metrics)[0];
  const t = first?.target_precision;
  return typeof t === "number" && t > 0 && t <= 1 ? t : DEFAULT_TARGET_PRECISION;
}

export type RefitOptions = {
  /**
   * Labelled examples (`[{ state, labels }]`) to re-fit an UPLOAD calibration
   * on. They replace the stored inputs, which lets a map fitted before inputs
   * were stored be re-fitted without changing its id.
   */
  examples?: unknown;
};

/**
 * Re-fit a calibration IN PLACE on the engine this deployment serves now: the
 * stored labelled inputs (or `opts.examples`) are answered again, graded, and
 * the maps, metrics and engine identity are replaced. The id stays the same,
 * so callers that pass `calibration_id` pick up the new maps without a code
 * change.
 */
export async function refitCalibration(
  userId: string,
  id: string,
  opts: RefitOptions = {},
): Promise<CalibrationDetail> {
  const sql = await getSql();
  const rows = await sql.query<Row>(`select ${COLS} from calibration_maps where id = $1 and user_id = $2`, [
    id,
    userId,
  ]);
  const r = rows[0];
  if (!r) throw new JevValidationError("calibration_not_found", `Calibration ${id} was not found.`);
  const current = toDetail(r);
  const method = current.method;
  const target = storedTarget(current.metrics);
  const model = assertCalibratableModel(current.model);
  const stored = parseStoredInputs(r.examples_json);

  let samples: Record<string, CalSample[]>;
  let served: string;
  let engine: EngineId | null;
  // Inputs to (re)store with the new maps; undefined keeps what is stored.
  let nextInputs: CalibrationExample[] | undefined;
  if (opts.examples !== undefined) {
    if (current.source !== "upload") {
      bad("`examples` can only be sent when re-fitting an uploaded calibration.");
    }
    const up = await samplesFromUpload(model, current.questions, opts.examples);
    samples = up.samples;
    served = up.served;
    engine = up.engine;
    nextInputs = up.examples;
  } else if (stored.kind === "eval_cases") {
    const out = await samplesFromStoredCases(stored.cases, model);
    samples = out.samples;
    served = out.served;
    engine = out.engine;
  } else if (current.source === "eval_run") {
    if (!current.eval_run_id) bad("This calibration has no eval run to re-answer.");
    const out = await samplesFromEvalRunReanswered(userId, current.eval_run_id, model);
    samples = out.samples;
    served = out.served;
    engine = out.engine;
  } else {
    if (stored.kind !== "examples") {
      bad(
        "This calibration was fitted before its labelled examples were stored. Re-fit it by " +
          "sending the same labels as `examples` with the re-fit request; they will be stored " +
          "so later re-fits need no upload.",
      );
    }
    const up = await samplesFromUpload(model, current.questions, stored.examples);
    samples = up.samples;
    served = up.served;
    engine = up.engine;
  }

  const fitted = fitAll(samples, method, target, `${id}:refit${current.refit_count + 1}`);
  await sql.query(
    `update calibration_maps
        set model = $3, maps_json = $4::jsonb, metrics_json = $5::jsonb, sample_count = $6,
            engine_kind = $7, engine_version = $8, fitted_at = now(),
            refit_count = refit_count + 1,
            examples_json = coalesce($9::jsonb, examples_json)
      where id = $1 and user_id = $2`,
    [
      id,
      userId,
      served,
      JSON.stringify(fitted.maps),
      JSON.stringify({ metrics: fitted.metrics, skipped: fitted.skipped }),
      fitted.sampleCount,
      engine?.kind ?? null,
      engine?.version ?? null,
      nextInputs ? JSON.stringify(nextInputs) : null,
    ],
  );
  const updated = await getCalibration(userId, id);
  if (!updated) throw new Error("Calibration was not persisted.");
  return updated;
}

type Row = {
  id: string;
  name: string;
  model: string;
  method: string;
  source: string;
  eval_run_id: string | null;
  questions_json: unknown;
  maps_json: unknown;
  metrics_json: unknown;
  sample_count: number;
  created_at: number;
  fitted_at: number | null;
  refit_count: number | null;
  engine_kind: string | null;
  engine_version: string | null;
  has_examples: boolean;
  examples_json?: unknown;
};

const SUMMARY_COLS = `id, name, model, method, source, eval_run_id, questions_json, maps_json,
  metrics_json, sample_count, engine_kind, engine_version, refit_count,
  (examples_json is not null) as has_examples,
  (extract(epoch from created_at) * 1000)::bigint as created_at,
  (extract(epoch from coalesce(fitted_at, created_at)) * 1000)::bigint as fitted_at`;

const COLS = `${SUMMARY_COLS}, examples_json`;

/**
 * The engine this deployment serves `model` with right now. Local presets are
 * the lexical engine; `system-one` is the embedding engine when its encoder is
 * installed; neural/cloud backends are keyed by model id.
 */
let currentSystemOne: Promise<EngineId> | null = null;
async function currentEngineFor(model: string): Promise<EngineId> {
  const resolved = resolveModel(model);
  if (resolved.backend === "laya" || resolved.backend === "otsone") {
    return { kind: "neural", version: resolved.id };
  }
  if (resolved.backend === "cloud") return { kind: "cloud", version: resolved.id };
  if (resolved.id !== DEFAULT_MODEL) return { kind: "lexical", version: LEXICAL_ENGINE_VERSION };
  currentSystemOne ??= (async () => {
    const { embedCapability } = await import("./embed/encoder.server");
    const { embedEngineVersion } = await import("./embed/params");
    const cap = await embedCapability();
    return cap.available
      ? ({ kind: "embedding", version: embedEngineVersion(cap.model) } as const)
      : ({ kind: "lexical", version: LEXICAL_ENGINE_VERSION } as const);
  })().catch((err: unknown) => {
    currentSystemOne = null;
    throw err;
  });
  return currentSystemOne;
}

function storedEngine(r: Pick<Row, "engine_kind" | "engine_version">): EngineId | null {
  return r.engine_kind && r.engine_version
    ? { kind: r.engine_kind as EngineKind, version: r.engine_version }
    : null;
}

function refitAvailability(r: Row): string | null {
  if (r.has_examples) return null;
  if (r.source === "eval_run") {
    return r.eval_run_id ? null : "This calibration has no eval run to re-answer.";
  }
  return (
    "Fitted before labelled examples were stored. Re-fit by sending the same labels as " +
    "`examples` with the re-fit request (POST /api/v1/calibrations?id=…&action=refit); " +
    "they are stored so later re-fits need no upload."
  );
}

async function toSummary(r: Row): Promise<CalibrationSummary> {
  const maps = parseJson<CalibrationMaps>(r.maps_json, {});
  const engine = storedEngine(r);
  const current = await currentEngineFor(r.model);
  const unavailable = refitAvailability(r);
  return {
    id: r.id,
    name: r.name,
    model: r.model,
    method: r.method as CalibrationMethodChoice,
    source: r.source === "eval_run" ? "eval_run" : "upload",
    eval_run_id: r.eval_run_id,
    sample_count: Number(r.sample_count),
    question_ids: Object.keys(maps),
    created_at: Number(r.created_at),
    fitted_at: Number(r.fitted_at ?? r.created_at),
    refit_count: Number(r.refit_count ?? 0),
    engine,
    engine_current: current,
    engine_mismatch: calibrationEngineMismatch(engine, current),
    refit_available: unavailable === null,
    refit_unavailable_reason: unavailable,
  };
}

type StoredDetail = Pick<
  CalibrationDetail,
  "model" | "method" | "source" | "eval_run_id" | "refit_count" | "questions" | "maps" | "metrics" | "skipped"
>;

function toDetail(r: Row): StoredDetail {
  const extra = parseJson<{ metrics?: Record<string, QuestionMetrics>; skipped?: Record<string, string> }>(
    r.metrics_json,
    {},
  );
  return {
    model: r.model,
    method: r.method as CalibrationMethodChoice,
    source: r.source === "eval_run" ? "eval_run" : "upload",
    eval_run_id: r.eval_run_id,
    refit_count: Number(r.refit_count ?? 0),
    questions: parseJson<Questions>(r.questions_json, {}),
    maps: parseJson<CalibrationMaps>(r.maps_json, {}),
    metrics: extra.metrics ?? {},
    skipped: extra.skipped ?? {},
  };
}

export async function listCalibrations(userId: string, limit = 50): Promise<CalibrationSummary[]> {
  const sql = await getSql();
  const rows = await sql.query<Row>(
    `select ${SUMMARY_COLS} from calibration_maps where user_id = $1
     order by created_at desc limit $2`,
    [userId, Math.min(Math.max(limit, 1), 200)],
  );
  return Promise.all(rows.map(toSummary));
}

export async function getCalibration(userId: string, id: string): Promise<CalibrationDetail | null> {
  const sql = await getSql();
  const rows = await sql.query<Row>(
    `select ${SUMMARY_COLS} from calibration_maps where id = $1 and user_id = $2`,
    [id, userId],
  );
  const r = rows[0];
  if (!r) return null;
  const d = toDetail(r);
  return {
    ...(await toSummary(r)),
    questions: d.questions,
    maps: d.maps,
    metrics: d.metrics,
    skipped: d.skipped,
  };
}

export async function deleteCalibration(userId: string, id: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `delete from calibration_maps where id = $1 and user_id = $2 returning id`,
    [id, userId],
  );
  return rows.length > 0;
}

/** The minimal shape run.ts needs at inference time. */
export type CalibrationForInference = {
  id: string;
  model: string;
  method: CalibrationMethod;
  maps: CalibrationMaps;
  /** Engine the maps were fitted on; null when unrecorded (never applied). */
  engine: EngineId | null;
};

/** Load a calibration's maps for inference, or null when not found. */
export async function getCalibrationMaps(
  userId: string,
  id: string,
): Promise<CalibrationForInference | null> {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string;
    model: string;
    maps_json: unknown;
    engine_kind: string | null;
    engine_version: string | null;
  }>(
    `select id, model, maps_json, engine_kind, engine_version
       from calibration_maps where id = $1 and user_id = $2`,
    [id, userId],
  );
  const r = rows[0];
  if (!r) return null;
  const maps = parseJson<CalibrationMaps>(r.maps_json, {});
  const methods = new Set(Object.values(maps).map((m) => m.method));
  return {
    id: r.id,
    model: r.model,
    method: methods.size === 1 && methods.has("temperature") ? "temperature" : "isotonic",
    maps,
    engine: storedEngine(r),
  };
}
