import {
  type Answer,
  type EntryType,
  type Question,
  type SystemOneRequest,
  type SystemOneResponse,
} from "./types";
import { round4 } from "./vector";

/**
 * OpenJev Cloud backend.
 *
 * Proxies openjev's typed decisions to a hosted OpenJev cloud endpoint
 * over the wire-compatible System One v1 API (`POST <base>/v1/systemone`). The
 * internal SystemOne wire contract (a `state` plus `questions` keyed by name,
 * with Choice / Score / Noul primitives) is the SAME shape the hosted API
 * expects, so translation is almost an identity — the one thing this module
 * fixes is the `model` field: openjev's cloud model ids
 * (`system-one-cloud`, and the legacy `jev*` aliases) are mapped to a hosted
 * model name (default `otsone-latest`, overridable via
 * `OPENJEV_DEFAULT_MODEL`).
 *
 * The critical wire detail (which produced a 422 in an earlier raw call): the
 * request body sends `questions` as a DICT keyed by name, NOT a list. See the
 * openjev `SystemOneRequestPayload` / `Questions` types.
 *
 * Self-host default: there is NO baked-in hosted endpoint. The cloud tier is
 * only used when BOTH a key (`OPENJEV_API_KEY`) and a base URL
 * (`OPENJEV_BASE_URL`) are configured; otherwise, and on any non-2xx / bad
 * body / thrown error, this returns `null` so `run.ts` degrades to the local
 * chain. Self-hosting therefore never requires a cloud key.
 *
 * Env vars are read OPENJEV_* first (primary), with the legacy TYPESAFE_*
 * names kept as back-compat aliases.
 */

const DEFAULT_CLOUD_MODEL = "otsone-latest";
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Read the hosted cloud key. Prefers `OPENJEV_API_KEY` (primary); accepts
 * the pre-rename `OPENTYPESAFE_API_KEY`, the legacy `TYPESAFE_API_KEY` and lowercase variants as back-compat aliases.
 */
export function cloudApiKey(): string | undefined {
  const raw =
    process.env.OPENJEV_API_KEY ??
    process.env.openjev_api_key ??
    process.env.OPENTYPESAFE_API_KEY ??
    process.env.opentypesafe_api_key ??
    process.env.TYPESAFE_API_KEY ??
    process.env.typesafe_api_key;
  const key = raw?.trim();
  return key ? key : undefined;
}

/**
 * Hosted API root. No branded default — set `OPENJEV_BASE_URL` (primary) or
 * the legacy `TYPESAFE_BASE_URL` to your own cloud endpoint. Returns `undefined`
 * when unset, which gates the cloud tier off (degrade to local).
 */
export function cloudBaseUrl(): string | undefined {
  const raw = (
    process.env.OPENJEV_BASE_URL ??
    process.env.OPENTYPESAFE_BASE_URL ??
    process.env.TYPESAFE_BASE_URL
  )?.trim();
  return raw ? raw.replace(/\/$/, "") : undefined;
}

/**
 * The hosted model name to send; overridable via `OPENJEV_DEFAULT_MODEL`
 * (primary) or the legacy `TYPESAFE_DEFAULT_MODEL`.
 */
export function cloudModel(): string {
  const raw = (
    process.env.OPENJEV_DEFAULT_MODEL ??
    process.env.OPENTYPESAFE_DEFAULT_MODEL ??
    process.env.TYPESAFE_DEFAULT_MODEL
  )?.trim();
  return raw ? raw : DEFAULT_CLOUD_MODEL;
}

/**
 * Whether the hosted cloud tier is fully configured (key + endpoint), used for
 * health / capability probes.
 */
export function cloudConfigured(): boolean {
  return cloudApiKey() !== undefined && cloudBaseUrl() !== undefined;
}

/** Hosted `POST /v1/systemone` request body — `questions` MUST be a dict keyed by name. */
type CloudRequestBody = {
  model: string;
  state: SystemOneRequest["state"];
  questions: Record<string, Question>;
};

/** Answer rows from the hosted API (openjev `ResultFor` shapes). */
type CloudChoice = {
  type: "choice";
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};
type CloudScore = {
  type: "score";
  score?: number;
  legend?: Record<string, EntryType>;
  probabilities?: Record<string, number>;
  confidence?: number;
};
type CloudNoul = { type: "noul"; noul?: number };
type CloudAnswer = CloudChoice | CloudScore | CloudNoul;

type CloudResponse = {
  model?: string;
  answers?: Record<string, CloudAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export async function runCloud(
  req: SystemOneRequest,
): Promise<SystemOneResponse | null> {
  const key = cloudApiKey();
  const base = cloudBaseUrl();
  // No key or no endpoint configured — degrade to the local chain (self-host).
  if (!key || !base) return null;

  const t0 = Date.now();
  try {
    // Translate to the hosted wire shape: identical state + questions-as-dict,
    // only the model id is resolved to a hosted model name.
    const body: CloudRequestBody = {
      model: cloudModel(),
      state: req.state,
      questions: req.questions,
    };
    const res = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        // De-branded client marker. Also emit the legacy header for back-compat
        // with any endpoint that keys off the old brand name.
        "X-OpenJev-Client": "openjev-cloud",
        "X-TypeSafe-Client": "openjev-cloud",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null; // Non-2xx (incl. 401/422) — fail clean.
    const parsed = (await res.json()) as CloudResponse;
    if (!parsed || typeof parsed !== "object" || !parsed.answers) return null;

    const answers = mapAnswers(req.questions, parsed.answers);
    return {
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : "system-one-cloud",
      answers,
      usage: {
        input_tokens: parsed.usage?.input_tokens ?? 0,
        output_tokens: parsed.usage?.output_tokens ?? 0,
      },
      latency_ms: Date.now() - t0,
    };
  } catch {
    return null; // Network / abort / parse error — degrade to local.
  }
}

/** Project the hosted answer rows onto openjev's strict Choice / Score / Noul shapes. */
function mapAnswers(
  questions: Record<string, Question>,
  raw: Record<string, CloudAnswer>,
): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = raw[id];
    if (q.type === "noul") {
      const n = a && a.type === "noul" ? a.noul : undefined;
      out[id] = { type: "noul", noul: round4(clamp01(typeof n === "number" ? n : 0.5)) };
      continue;
    }
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const probs = normalizeProbs(keys, a && a.type === "choice" ? a.probabilities : undefined);
      let best = keys[0] ?? "";
      for (const k of keys) if ((probs[k] ?? 0) > (probs[best] ?? 0)) best = k;
      const modelChoice =
        a && a.type === "choice" && a.choice && keys.includes(a.choice) ? a.choice : best;
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
    const probs = normalizeProbs(levelKeys, a && a.type === "score" ? a.probabilities : undefined);
    const legend: Record<string, EntryType> = {};
    let expected = 0;
    for (let i = 0; i < n; i++) {
      legend[String(i)] = q.criteria[i] ?? "";
      expected += i * (probs[String(i)] ?? 0);
    }
    out[id] = {
      type: "score",
      score: round4(a && a.type === "score" && typeof a.score === "number" ? a.score : expected),
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
