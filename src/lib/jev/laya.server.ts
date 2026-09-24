import {
  type Answer,
  type EntryType,
  type Question,
  type SystemOneRequest,
  type SystemOneResponse,
} from "./types";
import { round4 } from "./vector";

/**
 * Laya neural backend.
 *
 * Talks to a local Laya sidecar (the `laya-mlx` MLX runtime on macOS, or the
 * `laya-onnx` CPU runtime on Linux) over HTTP. The sidecar exposes the same
 * bidirectional typed-decision model behind a small JSON API; this module
 * probes its health and forwards the UNCHANGED SystemOne wire contract, then
 * maps Laya's native `predict` output into the strict Choice / Score / Noul
 * response shapes used across OpenJev.
 */

export type LayaBackend = "mlx" | "onnx";

const DEFAULT_URL = "http://127.0.0.1:8092";

/** Auto-select mlx on macOS, onnx on Linux; overridable via LAYA_BACKEND. */
export function layaBackend(): LayaBackend {
  const raw = process.env.LAYA_BACKEND?.trim().toLowerCase();
  if (raw === "mlx" || raw === "onnx") return raw;
  return process.platform === "darwin" ? "mlx" : "onnx";
}

export function layaEngineUrl(): string {
  return (process.env.LAYA_ENGINE_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

export async function layaHealth(): Promise<{
  ok: boolean;
  engine?: string;
  backend?: LayaBackend;
}> {
  try {
    const res = await fetch(`${layaEngineUrl()}/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { ok?: boolean; engine?: string };
    return {
      ok: body?.ok === true,
      engine: body?.engine,
      backend: layaBackend(),
    };
  } catch {
    return { ok: false };
  }
}

/** Laya `predict` answer rows (agent.py output schema). */
type LayaChoice = {
  type: "choice";
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};
type LayaScore = {
  type: "score";
  score?: number;
  legend?: Record<string, EntryType>;
  probabilities?: Record<string, number>;
  confidence?: number;
};
type LayaNoul = { type: "noul"; noul?: number };
type LayaAnswer = LayaChoice | LayaScore | LayaNoul;

type LayaResponse = {
  model?: string;
  answers?: Record<string, LayaAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export async function runLaya(
  req: SystemOneRequest,
): Promise<SystemOneResponse | null> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${layaEngineUrl()}/v1/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Laya-Backend": layaBackend(),
      },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as LayaResponse;
    if (!body || typeof body !== "object" || !body.answers) return null;
    const answers = mapAnswers(req.questions, body.answers);
    return {
      model: `laya-${layaBackend()}`,
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

/** Project Laya's native answer rows onto the strict wire shapes. */
function mapAnswers(
  questions: Record<string, Question>,
  raw: Record<string, LayaAnswer>,
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
