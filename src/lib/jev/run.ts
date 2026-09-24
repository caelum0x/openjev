import { runLocal, isLlmModel } from "./engine";
import { resolveModel, DEFAULT_MODEL, AUTO_MODEL, type ResolvedModel } from "./models";
import { recordUsage } from "./usage.server";
import { touchKey } from "./keys.server";
import { logActivity } from "./activity.server";
import { resolveUsageIdentity } from "./console-user.server";
import { JevValidationError, validateRequest } from "./validate";
import { applyScope } from "./scope";
import { applyCalibrationToAnswers } from "./calibration-fit";
import { calibrationEngineMismatch, engineIdOf } from "./engine-id";
import { escalationRequest, mergeEscalated, planEscalation } from "./cascade";
import type { SystemOneRequest, SystemOneResponse } from "./types";

/** Options for serving one validated request (no usage attribution). */
export type ServeOptions = {
  /** Owner of any `calibration_id` on the request. Required to apply one. */
  userId?: string | null;
  /** Set false to ignore `calibration_id` (used while FITTING a calibration). */
  calibrate?: boolean;
};

/**
 * Validate, serve, and attribute a System One call. The public entry point
 * used by the API routes, the playground server fn, decisions, and evals.
 */
export async function executeSystemOne(
  input: unknown,
  opts?: { key?: string; path?: string },
): Promise<SystemOneResponse> {
  const req = validateRequest(input);
  const key = opts?.key ?? "anon";
  const identity = req.calibration_id
    ? await resolveUsageIdentity(key).catch(() => null)
    : null;
  const out = await serveSystemOne(req, { userId: identity?.userId ?? null });
  await attributeUsage(req, out, key, opts?.path ?? "/api/v1/systemone");
  return out;
}

/**
 * Serve an already-validated request on the requested backend, then apply the
 * trust layer: out-of-scope scoring for every backend, the customer's
 * calibration map when `calibration_id` is set, and (for `auto`) escalation of
 * low-confidence questions to the LLM chain.
 */
export async function serveSystemOne(
  req: SystemOneRequest,
  opts: ServeOptions = {},
): Promise<SystemOneResponse> {
  const resolved = resolveModel(req.model);
  if (resolved.backend === "auto") return serveAuto(req, opts);
  const base = await dispatch(req, resolved);
  return applyCustomerCalibration(req, base, opts);
}

/**
 * Local tier used by `auto`: our otsone model when its sidecar is healthy,
 * otherwise the System One engine (native kernel when running, else in-process).
 */
async function serveLocalTier(req: SystemOneRequest): Promise<SystemOneResponse> {
  const { runOtsone } = await import("./otsone.server");
  const neural = await runOtsone({ ...req, model: "otsone-1" });
  if (neural) {
    return { ...neural, answers: applyScope(req, neural.answers, { damp: true }) };
  }
  return dispatch(req, resolveModel(DEFAULT_MODEL));
}

async function serveAuto(req: SystemOneRequest, opts: ServeOptions): Promise<SystemOneResponse> {
  const t0 = Date.now();
  const localRaw = await serveLocalTier(req);
  // Calibrate the local tier first: escalation thresholds compare against the
  // customer-calibrated confidence when a calibration map is supplied.
  const local = await applyCustomerCalibration(req, localRaw, opts);
  const plan = planEscalation(req, local.answers);
  const base = {
    local_model: local.model,
    escalated: [] as string[],
    kept: plan.keep,
    threshold: plan.threshold,
  };

  if (plan.escalate.length === 0) {
    return {
      ...local,
      model: AUTO_MODEL,
      latency_ms: Date.now() - t0,
      escalation: { ...base, kept: Object.keys(req.questions), provider: null, llm_model: null },
    };
  }

  const { escalateToLlm } = await import("./llm.server");
  const llm = await escalateToLlm(escalationRequest(req, plan.escalate));
  if (!llm.ok) {
    // Honest degradation: keep the local answers and say escalation did not run.
    return {
      ...local,
      model: AUTO_MODEL,
      latency_ms: Date.now() - t0,
      escalation: {
        ...base,
        kept: Object.keys(req.questions),
        provider: null,
        llm_model: null,
        needed: plan.escalate,
        skipped_reason: llm.reason,
      },
    };
  }

  const llmAnswers = applyScope(escalationRequest(req, plan.escalate), llm.answers, {
    damp: false,
  });
  return {
    ...local,
    model: AUTO_MODEL,
    answers: mergeEscalated(local.answers, llmAnswers, plan.escalate),
    usage: {
      input_tokens: local.usage.input_tokens + llm.usage.input_tokens,
      output_tokens: local.usage.output_tokens + llm.usage.output_tokens,
    },
    latency_ms: Date.now() - t0,
    escalation: {
      ...base,
      escalated: plan.escalate,
      provider: llm.provider,
      llm_model: llm.model,
      llm_usage: llm.usage,
    },
  };
}

/** Apply the request's `calibration_id` map (if any) to a served response. */
async function applyCustomerCalibration(
  req: SystemOneRequest,
  out: SystemOneResponse,
  opts: ServeOptions,
): Promise<SystemOneResponse> {
  if (!req.calibration_id || opts.calibrate === false) return out;
  if (!opts.userId) {
    throw new JevValidationError(
      "calibration_not_found",
      "`calibration_id` requires an authenticated caller (sign the request with your ots_live_ key).",
    );
  }
  const { getCalibrationMaps } = await import("./calibrations.server");
  const cal = await getCalibrationMaps(opts.userId, req.calibration_id);
  if (!cal) {
    throw new JevValidationError(
      "calibration_not_found",
      `Calibration ${req.calibration_id} was not found for this account.`,
    );
  }
  if (cal.model !== out.model) {
    // A map fitted on one model's confidences is meaningless on another's.
    return {
      ...out,
      calibration: {
        id: cal.id,
        method: cal.method,
        questions: [],
        skipped_reason: `fitted_on_${cal.model}_served_by_${out.model}`,
      },
    };
  }
  // Same model id is not enough: `system-one` is served by the embedding or
  // the lexical engine, and a map fitted on one engine's confidences does not
  // describe the other's. Refuse (and say why) instead of applying it.
  const mismatch = calibrationEngineMismatch(cal.engine, engineIdOf(out));
  if (mismatch) {
    return {
      ...out,
      calibration: { id: cal.id, method: cal.method, questions: [], skipped_reason: mismatch },
    };
  }
  const { answers, applied } = applyCalibrationToAnswers(out.answers, cal.maps);
  return {
    ...out,
    answers,
    calibration: { id: cal.id, method: cal.method, questions: applied },
  };
}

/** Run one request on one concrete backend, with out-of-scope scoring applied. */
async function dispatch(req: SystemOneRequest, resolved: ResolvedModel): Promise<SystemOneResponse> {
  if (resolved.backend === "cloud") {
    // Explicit selection of the hosted OpenJev cloud backend. Proxy the
    // typed questions to the configured cloud endpoint (wire-compatible System
    // One v1 API); degrade to the local engine when the key/endpoint is missing
    // or the API is unavailable (fail-clean, no cloud dependency).
    const { runCloud } = await import("./cloud.server");
    const cloud = await runCloud({ ...req, model: resolved.id });
    if (!cloud) return runLocal(req, resolved.id);
    // Hosted System One models are the ones reviewers caught answering
    // off-topic inputs at 0.99; score and damp them like every local backend.
    return { ...cloud, answers: applyScope(req, cloud.answers, { damp: true }) };
  }
  if (isLlmModel(resolved.id)) {
    // Explicit escalation: hand the typed questions straight to the LLM. LLM
    // answers get an `ood` score but are not damped (they read semantics).
    const { runLlm } = await import("./llm.server");
    const out = await runLlm({ ...req, model: resolved.id });
    if (out.fallback) return out; // served by runLocal, already scoped
    return { ...out, answers: applyScope(req, out.answers, { damp: false }) };
  }
  if (resolved.backend === "laya" || resolved.backend === "otsone") {
    // Neural sidecars that are NOT present on a fresh install. Health-gate
    // them: when the sidecar is unavailable we must not label a local-engine
    // answer as `laya-*` / `otsone-*` (a silent, misleading substitution).
    // Instead we run the always-on local engine under its REAL id and attach a
    // `fallback` flag so the caller knows exactly which backend answered.
    const scoped = { ...req, model: resolved.id };
    const isLaya = resolved.backend === "laya";
    const neural = isLaya
      ? await (await import("./laya.server")).runLaya(scoped)
      : await (await import("./otsone.server")).runOtsone(scoped);
    if (neural) {
      return { ...neural, answers: applyScope(req, neural.answers, { damp: true }) };
    }
    const local = await serveDefaultLocal(req);
    const name = isLaya ? "Laya" : "otsone";
    return {
      ...local,
      fallback: {
        requested: resolved.id,
        served: local.model,
        reason: isLaya ? "laya_sidecar_unavailable" : "otsone_sidecar_unavailable",
        detail:
          `The ${resolved.id} backend is not installed or not reachable, so ` +
          `this decision was answered by the local ${local.model} engine. ` +
          `Start the ${name} sidecar (see SELF-HOSTING.md) to use ${resolved.id}.`,
      },
    };
  }
  // Local backend. The native kernel sidecar is a transparent, same-answer
  // accelerator of the SAME engine, so using it (when healthy) or the
  // in-process pure-TS engine yields the same model id either way — no
  // mislabeling. Laya is never substituted here; it is opt-in above.
  const scoped = { ...req, model: resolved.id };
  if (resolved.id === DEFAULT_MODEL) return serveDefaultLocal(req);
  const { runNative } = await import("./native.server");
  const native = await runNative(scoped);
  if (native) return { ...native, answers: applyScope(req, native.answers, { damp: true }) };
  // runLocal is the always-on floor; it never returns null and scopes itself.
  return runLocal(req, resolved.id);
}

/**
 * The default `system-one` engine: the sentence-embedding engine when its
 * model file and onnxruntime are installed, else the lexical engine (native
 * kernel when running, else in-process). `engine` says which one answered.
 */
export async function serveDefaultLocal(req: SystemOneRequest): Promise<SystemOneResponse> {
  const { runEmbed } = await import("./embed/run.server");
  const { embedCapability } = await import("./embed/encoder.server");
  let failure: string | null = null;
  const embedded = await runEmbed({ ...req, model: DEFAULT_MODEL }).catch((err: unknown) => {
    failure = `embedding engine error: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[openjev] embedding engine failed; serving the lexical engine:", err);
    return null;
  });
  if (embedded) return embedded;
  const cap = await embedCapability();
  const reason = failure ?? (cap.available ? "embedding engine unavailable" : cap.reason);
  const { runNative } = await import("./native.server");
  const native = await runNative({ ...req, model: DEFAULT_MODEL });
  const base = native
    ? { ...native, answers: applyScope(req, native.answers, { damp: true }) }
    : runLocal(req, DEFAULT_MODEL);
  return { ...base, engine: { kind: "lexical", reason } };
}

/**
 * Persist the usage event and an activity_log row for a completed decision,
 * scoped to the owning user. Best-effort: attribution must NEVER fail a
 * decision, so every step is wrapped and a user we can't resolve is skipped.
 *
 * The user is the key's owner when the request is signed with an `ots_live_…`
 * key; otherwise the verified session user (or the dev user in the auth-disabled
 * preview). Anonymous, unauthenticated calls simply record nothing.
 */
async function attributeUsage(
  req: SystemOneRequest,
  out: SystemOneResponse,
  key: string,
  path: string,
): Promise<void> {
  try {
    const identity = await resolveUsageIdentity(key);
    if (!identity) return;
    const { userId, keyId } = identity;

    if (keyId) await touchKey(keyId).catch(() => undefined);

    const questions = Object.keys(req.questions).length;
    await recordUsage({
      userId,
      keyId,
      model: out.model,
      path,
      questions,
      input_tokens: out.usage.input_tokens,
      output_tokens: out.usage.output_tokens,
      latency_ms: out.latency_ms,
      status: "ok",
    });
    const escalated = out.escalation?.escalated.length ?? 0;
    await logActivity({
      userId,
      kind: "decision",
      summary:
        `${out.model} · ${questions} question${questions === 1 ? "" : "s"} · ${path}` +
        (escalated ? ` · ${escalated} escalated` : ""),
      meta: {
        keyId,
        model: out.model,
        questions,
        path,
        latency_ms: out.latency_ms,
        input_tokens: out.usage.input_tokens,
        output_tokens: out.usage.output_tokens,
        ...(out.escalation
          ? {
              escalated: out.escalation.escalated,
              escalation_provider: out.escalation.provider,
              escalation_skipped: out.escalation.skipped_reason ?? null,
            }
          : {}),
        ...(out.calibration ? { calibration_id: out.calibration.id } : {}),
      },
    });
  } catch {
    // Never let usage attribution surface as a decision failure.
  }
}

export function asRequest(input: unknown): SystemOneRequest {
  return validateRequest(input);
}

/**
 * Cookbook evaluator on the real serving path: the request is validated and
 * served exactly like POST /api/v1/systemone (embedding engine when installed),
 * without usage attribution (the cookbook route records its own usage).
 */
export function serveCookbook(req: SystemOneRequest): Promise<SystemOneResponse> {
  return serveSystemOne(validateRequest(req));
}
