import {
  type Answer,
  type EntryType,
  type Question,
  type SystemOneRequest,
  type SystemOneResponse,
} from "./types";
import { round4 } from "./vector";

/**
 * OpenJev (otsone) neural backend — OUR OWN model.
 *
 * Talks to a local otsone sidecar over HTTP. The sidecar serves our `otsone-base`
 * ONNX model (produced by the laya-mlx training pipeline) behind the SAME small
 * JSON API the Laya sidecar exposes, so by default this points at the Laya
 * sidecar started with `LAYA_BACKEND=onnx` and a model path of `models/otsone-base`.
 *
 * Config (env):
 *   - `OTSONE_MODEL_URL` — sidecar base URL. Defaults to the Laya sidecar
 *     (127.0.0.1:8092), which is expected to serve otsone-base in onnx mode.
 *   - `OTSONE_BACKEND`   — served runtime variant, `onnx` (default) or `mlx`.
 *   - `OTSONE_MODEL`     — served model name; defaults to `otsone-base`.
 *
 * Mirrors laya.server.ts: probe health, forward the UNCHANGED SystemOne wire
 * contract, map the native `predict` output into strict Choice / Score / Noul,
 * and FAIL CLEAN (return `null`) whenever the sidecar is missing or misbehaves —
 * so run.ts degrades to the deterministic local engine under an honest fallback
 * marker instead of silently mislabeling a local answer as otsone.
 */

export type OtsoneBackend = "onnx" | "mlx";

// Same default as the Laya sidecar: by default otsone-base is served there in
// onnx mode. Override with OTSONE_MODEL_URL to run a dedicated otsone sidecar.
const DEFAULT_URL = "http://127.0.0.1:8092";
const DEFAULT_MODEL_NAME = "otsone-base";
const REQUEST_TIMEOUT_MS = 8000;

/** Served runtime variant; onnx by default, overridable via OTSONE_BACKEND. */
export function otsoneBackend(): OtsoneBackend {
  const raw = process.env.OTSONE_BACKEND?.trim().toLowerCase();
  if (raw === "mlx" || raw === "onnx") return raw;
  return "onnx";
}

/** Sidecar base URL; defaults to the Laya sidecar serving otsone-base. */
export function otsoneEngineUrl(): string {
  return (process.env.OTSONE_MODEL_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

/** The served model name to request; defaults to `otsone-base`. */
export function otsoneModelName(): string {
  const raw = process.env.OTSONE_MODEL?.trim();
  return raw ? raw : DEFAULT_MODEL_NAME;
}

export async function otsoneHealth(): Promise<{
  ok: boolean;
  engine?: string;
  backend?: OtsoneBackend;
}> {
  try {
    const res = await fetch(`${otsoneEngineUrl()}/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { ok?: boolean; engine?: string };
    return {
      ok: body?.ok === true,
      engine: body?.engine,
      backend: otsoneBackend(),
    };
  } catch {
    return { ok: false };
  }
}

/** otsone `predict` answer rows (same schema as the Laya sidecar). */
type OtsoneChoice = {
  type: "choice";
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};
type OtsoneScore = {
  type: "score";
  score?: number;
  legend?: Record<string, EntryType>;
  probabilities?: Record<string, number>;
  confidence?: number;
};
type OtsoneNoul = { type: "noul"; noul?: number };
type OtsoneAnswer = OtsoneChoice | OtsoneScore | OtsoneNoul;

type OtsoneResponse = {
  model?: string;
  answers?: Record<string, OtsoneAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export async function runOtsone(
  req: SystemOneRequest,
): Promise<SystemOneResponse | null> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${otsoneEngineUrl()}/v1/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OTSone-Backend": otsoneBackend(),
        "X-OTSone-Model": otsoneModelName(),
      },
      // Send the served model name so the sidecar loads otsone-base, but keep
      // the rest of the SystemOne contract byte-for-byte.
      body: JSON.stringify({ ...req, model: otsoneModelName() }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as OtsoneResponse;
    if (!body || typeof body !== "object" || !body.answers) return null;
    const answers = mapAnswers(req.questions, body.answers);
    return {
      // Report the requested otsone id (otsone-1 / otsone-mini) so the caller
      // sees exactly which model answered. run.ts scopes `req.model` to that id.
      model: typeof req.model === "string" && req.model ? req.model : OTSONE_DEFAULT_ID,
      answers,
      usage: {
        input_tokens: body.usage?.input_tokens ?? 0,
        output_tokens: body.usage?.output_tokens ?? 0,
      },
      latency_ms: Date.now() - t0,
    };
  } catch {
    return null;
  }
}

const OTSONE_DEFAULT_ID = "otsone-1";

/** Project otsone's native answer rows onto the strict wire shapes. */
function mapAnswers(
  questions: Record<string, Question>,
  raw: Record<string, OtsoneAnswer>,
): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = raw[id];
    if (q.type === "noul") {
      const n = a && a.type === "noul" ? a.noul : undefined;
      out[id] = { type: "noul", noul: round4(clamp01(n ?? 0.5)) };
      continue;
    }
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const probs = normalizeProbs(
        keys,
        a && a.type === "choice" ? a.probabilities : undefined,
      );
      let best = keys[0] ?? "";
      for (const k of keys) if ((probs[k] ?? 0) > (probs[best] ?? 0)) best = k;
      const modelChoice =
        a && a.type === "choice" && a.choice && keys.includes(a.choice)
          ? a.choice
          : best;
      out[id] = {
        type: "choice",
        choice: modelChoice,
        probabilities: probs,
        confidence: round4(
          clamp01(
            a && a.type === "choice" && typeof a.confidence === "number"
              ? a.confidence
              : peakedness(Object.values(probs)),
          ),
        ),
      };
      continue;
    }
    // score
    const n = q.criteria.length;
    const levelKeys = Array.from({ length: n }, (_, i) => String(i));
    const probs = normalizeProbs(
      levelKeys,
      a && a.type === "score" ? a.probabilities : undefined,
    );
    const legend: Record<string, EntryType> = {};
    let expected = 0;
    for (let i = 0; i < n; i++) {
      legend[String(i)] = q.criteria[i] ?? "";
      expected += i * (probs[String(i)] ?? 0);
    }
    out[id] = {
      type: "score",
      score: round4(
        a && a.type === "score" && typeof a.score === "number"
          ? a.score
          : expected,
      ),
      legend,
      probabilities: probs,
      confidence: round4(
        clamp01(
          a && a.type === "score" && typeof a.confidence === "number"
            ? a.confidence
            : peakedness(Object.values(probs)),
        ),
      ),
    };
  }
  return out;
}

/** Keep only known keys, clamp to non-negative, renormalize to sum 1. */
function normalizeProbs(
  keys: string[],
  raw: Record<string, number> | undefined,
): Record<string, number> {
  const probs: Record<string, number> = {};
  let total = 0;
  for (const k of keys) {
    const v = raw && typeof raw[k] === "number" ? Math.max(0, raw[k]) : 0;
    probs[k] = v;
    total += v;
  }
  if (total <= 0) {
    const uniform = keys.length > 0 ? 1 / keys.length : 0;
    for (const k of keys) probs[k] = round4(uniform);
    return probs;
  }
  for (const k of keys) probs[k] = round4((probs[k] ?? 0) / total);
  return probs;
}

/** Fallback confidence: distance of the peak from a uniform distribution. */
function peakedness(values: number[]): number {
  if (values.length === 0) return 0;
  const peak = Math.max(...values);
  const uniform = 1 / values.length;
  return clamp01((peak - uniform) / (1 - uniform || 1));
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
