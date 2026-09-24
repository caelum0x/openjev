/**
 * OpenJev as an AI SDK evaluation model (`experimental_evaluate`).
 *
 * The AI SDK's evaluation contract is the same shape as System One: one shared
 * state, named choice / score / boolean questions, typed answers with
 * distributions. This adapter maps `boolean` to Noul, sends one /v1/systemone
 * request, and normalises the answers to what the AI SDK validates: complete
 * distributions over exactly the declared options, the argmax as the choice,
 * and the score as the probability-weighted mean.
 *
 * OpenJev's extra trust signals (confidence, abstain, out-of-scope score,
 * escalation, calibration) do not fit the core answer type, so they are
 * returned in `providerMetadata.openjev`, and an abstained answer adds a
 * warning. An abstaining Choice still has to name a real option for the AI SDK,
 * so the answer is the best real option and `abstained: true` sits in metadata.
 */
import type { Questions, SystemOneRequest, SystemOneResult } from "@openjev/sdk";
import type { Experimental_EvaluationModel } from "ai";
import { type AnyAnswer, NONE_LABEL, toNumberRecord } from "./summary.js";

export type EvaluationModelV4 = Exclude<Experimental_EvaluationModel, string>;
type CallOptions = Parameters<EvaluationModelV4["doEvaluate"]>[0];
type EvalQuestion = CallOptions["questions"][string];
type EvalResult = Awaited<ReturnType<EvaluationModelV4["doEvaluate"]>>;
type EvalAnswer = EvalResult["answers"][string];
type Warning = EvalResult["warnings"][number];
type JsonObject = Record<string, NonNullable<EvalResult["providerMetadata"]>[string][string]>;

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

export type Runner = (
  request: SystemOneRequest<Questions>,
  options: RunOptions,
) => Promise<SystemOneResult<Questions>>;

/** Per-call options under `providerOptions.openjev`. */
export interface OpenJevEvaluationOptions {
  readonly calibrationId?: string;
  readonly abstain?: boolean;
  readonly abstainBelow?: number;
  readonly escalateBelow?: number;
}

function toSystemOneQuestion(q: EvalQuestion): Questions[string] {
  if (q.type === "boolean") {
    return {
      type: "noul",
      instructions: q.instructions,
      ...(q.criteria ? { criteria: q.criteria } : {}),
    } as Questions[string];
  }
  return { type: q.type, instructions: q.instructions, criteria: q.criteria } as Questions[string];
}

/** Keep exactly `keys`, fill missing with 0, renormalise to sum 1 (uniform when all mass was elsewhere). */
function normalise(probs: Record<string, number>, keys: readonly string[]): Record<string, number> {
  const kept = keys.map((k) => {
    const p = probs[k];
    return typeof p === "number" && Number.isFinite(p) && p > 0 ? p : 0;
  });
  const total = kept.reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    keys.map((k, i) => [k, total > 0 ? (kept[i] ?? 0) / total : 1 / keys.length]),
  );
}

function argmax(probs: Record<string, number>, prefer: string | undefined): string {
  let best = "";
  let bestP = -1;
  for (const [k, p] of Object.entries(probs)) {
    if (p > bestP) {
      best = k;
      bestP = p;
    }
  }
  return prefer !== undefined && probs[prefer] === bestP ? prefer : best;
}

function toEvalAnswer(q: EvalQuestion, a: AnyAnswer): EvalAnswer {
  if (q.type === "boolean") {
    if (a.type !== "noul") throw new Error("OpenJev returned a non-Noul answer for a boolean question.");
    return { type: "boolean", probability: Math.min(1, Math.max(0, a.noul)) };
  }
  if (q.type === "choice") {
    if (a.type !== "choice") throw new Error("OpenJev returned a non-Choice answer for a choice question.");
    const probabilities = normalise(toNumberRecord(a.probabilities), Object.keys(q.criteria));
    const prefer = a.choice === NONE_LABEL ? undefined : a.choice;
    return { type: "choice", choice: argmax(probabilities, prefer), probabilities };
  }
  if (a.type !== "score") throw new Error("OpenJev returned a non-Score answer for a score question.");
  const keys = q.criteria.map((_, i) => String(i));
  const probabilities = normalise(toNumberRecord(a.probabilities), keys);
  const mean = keys.reduce((sum, k) => sum + Number(k) * (probabilities[k] ?? 0), 0);
  return { type: "score", score: Math.min(keys.length - 1, Math.max(0, mean)), probabilities };
}

function trustMetadata(a: AnyAnswer): JsonObject {
  const confidence = a.type === "noul" ? Math.max(a.noul, 1 - a.noul) : a.confidence;
  const meta: JsonObject = {
    confidence,
    abstained: a.abstained === true || (a.type === "choice" && a.choice === NONE_LABEL),
    escalated: a.escalated === true,
    calibrated: a.calibrated === true,
  };
  if (a.abstain_reason) meta.abstain_reason = a.abstain_reason;
  if (typeof a.ood === "number") meta.ood = a.ood;
  if (typeof a.p_none === "number") meta.p_none = a.p_none;
  return meta;
}

function readOptions(options: CallOptions["providerOptions"]): OpenJevEvaluationOptions {
  const raw = (options?.openjev ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && v >= 0 && v <= 1 ? v : undefined;
  return {
    ...(typeof raw.calibrationId === "string" ? { calibrationId: raw.calibrationId } : {}),
    ...(typeof raw.abstain === "boolean" ? { abstain: raw.abstain } : {}),
    ...(num(raw.abstainBelow) !== undefined ? { abstainBelow: num(raw.abstainBelow) } : {}),
    ...(num(raw.escalateBelow) !== undefined ? { escalateBelow: num(raw.escalateBelow) } : {}),
  };
}

function cleanHeaders(headers: CallOptions["headers"]): Record<string, string> | undefined {
  if (!headers) return undefined;
  const entries = Object.entries(headers).filter((e): e is [string, string] => typeof e[1] === "string");
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function createEvaluationModel(
  modelId: string,
  run: Runner,
  provider = "openjev",
): EvaluationModelV4 {
  return {
    specificationVersion: "v4",
    provider,
    modelId,
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate(options: CallOptions): Promise<EvalResult> {
      const opts = readOptions(options.providerOptions);
      const questions = Object.fromEntries(
        Object.entries(options.questions).map(([id, q]) => [id, toSystemOneQuestion(q)]),
      );
      const headers = cleanHeaders(options.headers);
      const result = await run(
        {
          state: options.state as SystemOneRequest<Questions>["state"],
          questions,
          model: modelId,
          ...(opts.calibrationId ? { calibration_id: opts.calibrationId } : {}),
          ...(opts.abstain !== undefined ? { abstain: opts.abstain } : {}),
          ...(opts.abstainBelow !== undefined ? { abstain_below: opts.abstainBelow } : {}),
          ...(opts.escalateBelow !== undefined ? { escalate_below: opts.escalateBelow } : {}),
        },
        { ...(options.abortSignal ? { signal: options.abortSignal } : {}), ...(headers ? { headers } : {}) },
      );

      const answers: Record<string, EvalAnswer> = {};
      const perQuestion: JsonObject = {};
      const warnings: Warning[] = [];
      for (const [id, q] of Object.entries(options.questions)) {
        const a = result.answers[id] as AnyAnswer | undefined;
        if (!a) throw new Error(`OpenJev returned no answer for question "${id}".`);
        answers[id] = toEvalAnswer(q, a);
        const meta = trustMetadata(a);
        perQuestion[id] = meta;
        if (meta.abstained === true) {
          warnings.push({
            type: "other",
            message: `OpenJev abstained on "${id}" (${a.abstain_reason ?? "abstained"}); the answer is its best guess. See providerMetadata.openjev.answers.`,
          });
        }
      }

      const openjev: JsonObject = { model: result.model, answers: perQuestion };
      if (result.escalation) openjev.escalated = [...result.escalation.escalated];
      if (result.calibration) openjev.calibration_id = result.calibration.id;
      if (result.fallback) openjev.served_by = result.fallback.served;
      if (typeof result.latency_ms === "number") openjev.latency_ms = result.latency_ms;

      return {
        answers,
        usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
        warnings,
        providerMetadata: { openjev },
        response: { modelId: result.model, timestamp: new Date() },
      };
    },
  };
}
