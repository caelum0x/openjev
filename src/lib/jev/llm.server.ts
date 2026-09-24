import { getSql } from "@/lib/db";
import { runLocal } from "./engine";
import { LLM_MODEL } from "./models";
import {
  railyardChat,
  railyardLlmEnabled,
  resolveRailyardModel,
} from "@/lib/railyard/llm";
import type { OpenAIChatBody } from "@/lib/railyard/abacus";
import {
  LOCAL_MODEL,
  type Answer,
  type EntryType,
  type Question,
  type SystemOneRequest,
  type SystemOneResponse,
} from "./types";
import { peakedConfidence, round4, softmax } from "./vector";

/**
 * Provider-agnostic LLM escalation backend.
 *
 * The local System One / Laya engines answer typed questions offline. When a
 * caller explicitly escalates (the `openjev-grok` model), we hand the SAME
 * typed wire contract to a hosted LLM and coerce whatever it returns back into
 * the strict Choice / Score / Noul shapes.
 *
 * Provider selection is env-driven:
 *   - `LLM_PROVIDER` pins one of `groq` | `ollama` | `openai` | `xai` (aka
 *     `grok`) | `anthropic`.
 *   - When `LLM_PROVIDER` is unset EVERY configured provider forms a chain,
 *     free first: Groq (GROQ_API_KEY, free tier) -> Ollama (OLLAMA_BASE_URL,
 *     local, keyless) -> OpenAI -> xAI -> Anthropic. A failing provider falls
 *     through to the next.
 *   - Each provider reads its own key and an optional `<PROVIDER>_MODEL`.
 *   - With no usable provider we fall back to the always-on local engine
 *     (`runLocal`) under an explicit `fallback` marker.
 */

const WINDOW_MS = 5 * 60 * 1000;
// Trailing window in whole seconds. Derived from WINDOW_MS (a trusted numeric
// constant, never user input) so it is the single source of truth shared by the
// in-process guard and the SQL interval literal below.
const WINDOW_SECONDS = WINDOW_MS / 1000;
/**
 * Global LLM calls allowed per 5-minute window. Defaults to 8 (safe for a
 * public preview that pays for its own key); raise it with
 * `LLM_RATE_LIMIT_PER_5MIN` in production (the `auto` model escalates only
 * low-confidence questions, so the real call volume is a fraction of traffic).
 */
function maxCalls(): number {
  const raw = Number(process.env.LLM_RATE_LIMIT_PER_5MIN);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8;
}

/**
 * In-process SOFT guard only — a fast local pre-check that avoids a DB round-trip
 * for obvious floods. It is NOT authoritative: the shared DB limiter in
 * `rateOk()` enforces the GLOBAL cap across every worker / serverless instance
 * (the old module-level version was per-process, so multi-worker deploys silently
 * bypassed the cap and it reset on restart). Because every allowed call also
 * records a row in the shared store, this process's local count can never exceed
 * the global count — so a local rejection is always a correct rejection.
 */
const stamps: number[] = [];

function localFastPathBlocked(now: number): boolean {
  while (stamps.length && (stamps[0] ?? 0) < now - WINDOW_MS) stamps.shift();
  return stamps.length >= maxCalls();
}

/**
 * Global, cross-process rate limit for the LLM escalation backend
 * (`maxCalls()` per 5 minutes). The counter lives in the shared `llm_rate_limit` table so the cap
 * holds across workers and restarts.
 *
 * One SQL round-trip does everything: prune expired rows, count the trailing
 * window, and insert a fresh stamp ONLY when the count is under the cap — so the
 * stored rows reflect ALLOWED calls, matching the old in-memory semantics.
 *
 * Fail-open: a limiter/DB outage must never block a (paid) escalation call, so on
 * any DB error we allow the call, record it in the local guard, and log.
 */
async function rateOk(): Promise<boolean> {
  const now = Date.now();
  // Fast local soft guard first — reject obvious floods without a DB round-trip.
  if (localFastPathBlocked(now)) return false;

  try {
    const sql = await getSql();
    const rows = await sql.query<{ allowed: boolean }>(
      `with pruned as (
         delete from llm_rate_limit
         where bucket = 'global'
           and called_at <= now() - interval '${WINDOW_SECONDS} seconds'
       ),
       win as (
         select count(*)::int as c
         from llm_rate_limit
         where bucket = 'global'
           and called_at > now() - interval '${WINDOW_SECONDS} seconds'
       ),
       ins as (
         insert into llm_rate_limit (bucket)
         select 'global' where (select c from win) < $1
         returning 1
       )
       select (select count(*) from ins) > 0 as allowed`,
      [maxCalls()],
    );
    const allowed = rows[0]?.allowed ?? true;
    if (allowed) stamps.push(now);
    return allowed;
  } catch (err) {
    // Fail-open: never block a paid call on a limiter outage. Still record in the
    // local guard so this process keeps some throttle, and log for visibility.
    stamps.push(now);
    console.warn("[llm] shared rate-limit check failed; failing open", err);
    return true;
  }
}

export type LlmProvider = "groq" | "ollama" | "openai" | "xai" | "anthropic";

/**
 * Auto-detect order when `LLM_PROVIDER` is unset: FREE first. Groq has a free
 * API tier; Ollama is a local, keyless server; the paid providers follow and are
 * only used when their key is set. Every configured provider joins the chain,
 * so a failing provider falls through to the next one.
 */
const PROVIDER_ORDER: readonly LlmProvider[] = ["groq", "ollama", "openai", "xai", "anthropic"];

const PROVIDER_ALIASES: Record<string, LlmProvider> = {
  groq: "groq",
  ollama: "ollama",
  local: "ollama",
  openai: "openai",
  oai: "openai",
  gpt: "openai",
  xai: "xai",
  grok: "xai",
  anthropic: "anthropic",
  claude: "anthropic",
};

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3.1:8b",
  openai: "gpt-4.1-mini",
  xai: "grok-4.5",
  anthropic: "claude-opus-5",
};

type ProviderConfig = {
  provider: LlmProvider;
  apiKey: string;
  model: string;
};

/**
 * The credential for a provider, or undefined when it is not configured. Ollama
 * is keyless: it is "configured" when `OLLAMA_BASE_URL` is set, and we pass a
 * placeholder bearer (Ollama ignores it).
 */
function apiKeyFor(provider: LlmProvider): string | undefined {
  if (provider === "groq") return process.env.GROQ_API_KEY || undefined;
  if (provider === "ollama") return process.env.OLLAMA_BASE_URL ? "ollama" : undefined;
  if (provider === "openai") return process.env.OPENAI_API_KEY || undefined;
  if (provider === "xai") return process.env.XAI_API_KEY || undefined;
  return process.env.ANTHROPIC_API_KEY || undefined;
}

function modelFor(provider: LlmProvider): string {
  const override: Record<LlmProvider, string | undefined> = {
    groq: process.env.GROQ_MODEL,
    ollama: process.env.OLLAMA_MODEL,
    openai: process.env.OPENAI_MODEL,
    xai: process.env.XAI_MODEL,
    anthropic: process.env.ANTHROPIC_MODEL,
  };
  return override[provider] || DEFAULT_MODELS[provider];
}

function configFor(provider: LlmProvider): ProviderConfig | null {
  const apiKey = apiKeyFor(provider);
  return apiKey ? { provider, apiKey, model: modelFor(provider) } : null;
}

/**
 * Every configured provider, in attempt order. `LLM_PROVIDER` pins a single
 * provider (an unknown value or a missing key yields an empty chain, which
 * callers report as "no LLM configured" rather than silently picking another).
 */
export function resolveProviderChain(): ProviderConfig[] {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit) {
    const provider = PROVIDER_ALIASES[explicit];
    const cfg = provider ? configFor(provider) : null;
    return cfg ? [cfg] : [];
  }
  return PROVIDER_ORDER.map(configFor).filter((c): c is ProviderConfig => c !== null);
}

/**
 * The first configured provider, or `null` when none is set (callers then fall
 * back to the local engine).
 */
export function resolveProvider(): ProviderConfig | null {
  return resolveProviderChain()[0] ?? null;
}

/** Whether any LLM provider is configured (used by status endpoints). */
export function llmAvailable(): boolean {
  return resolveProvider() !== null;
}

type LlmChoice = {
  type: "choice";
  id: string;
  probabilities: { option: string; p: number }[];
  confidence: number;
};
type LlmScore = {
  type: "score";
  id: string;
  probabilities: { level: number; p: number }[];
  score: number;
  confidence: number;
};
type LlmNoul = { type: "noul"; id: string; noul: number };
type LlmOut = { answers: Array<LlmChoice | LlmScore | LlmNoul> };

type ProviderResult = {
  parsed: LlmOut | null;
  usage: { input_tokens: number; output_tokens: number };
};

function openAiBase(provider: LlmProvider): string {
  if (provider === "groq") return "https://api.groq.com/openai/v1";
  if (provider === "ollama") {
    const base = (process.env.OLLAMA_BASE_URL ?? "").replace(/\/+$/, "");
    return base.endsWith("/v1") ? base : `${base}/v1`;
  }
  if (provider === "xai") return "https://api.x.ai/v1";
  // Any OpenAI-compatible endpoint (OpenRouter, a local gateway, Azure proxy).
  const base = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "");
  return base || "https://api.openai.com/v1";
}

function bearer(apiKey: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
}

/** Shape of an OpenAI-compatible chat.completions response we consume. */
type OpenAiChatJson = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * POST an OpenAI-compatible chat body, routing through railyard (Abacus → Relay)
 * when it is opt-in-configured so this app's own LLM spend is capped + metered,
 * otherwise hitting the provider directly exactly as before. Returns null on any
 * failure — the caller then degrades to the deterministic local engine. When
 * railyard is enabled we never bypass the gateway to the raw provider: an
 * exhausted cap / gateway outage degrades locally rather than escaping the cap.
 */
async function postOpenAiChat(
  cfg: ProviderConfig,
  body: Record<string, unknown>,
): Promise<OpenAiChatJson | null> {
  if (railyardLlmEnabled() && cfg.provider !== "ollama") {
    try {
      const routed = { ...body, model: resolveRailyardModel(cfg.model) };
      const { completion } = await railyardChat({
        body: routed as OpenAIChatBody,
        providerKey: cfg.apiKey,
      });
      return completion as OpenAiChatJson;
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(`${openAiBase(cfg.provider)}/chat/completions`, {
      method: "POST",
      headers: bearer(cfg.apiKey),
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as OpenAiChatJson;
  } catch {
    return null;
  }
}

/** Outcome of an escalation attempt (never throws). */
export type LlmEscalationResult =
  | {
      ok: true;
      provider: LlmProvider;
      model: string;
      answers: Record<string, Answer>;
      usage: { input_tokens: number; output_tokens: number };
      latency_ms: number;
    }
  | { ok: false; reason: "no_llm_configured" | "rate_limited" | "llm_error"; detail: string };

/**
 * Ask the configured LLM chain the typed questions in `req`. Tries each
 * configured provider in order (free first) until one returns a parseable
 * answer. Used by the explicit escalation model, the `auto` cascade, and
 * shadow mode. Never throws; failures come back as `{ ok: false, reason }`.
 */
export async function escalateToLlm(req: SystemOneRequest): Promise<LlmEscalationResult> {
  const chain = resolveProviderChain();
  if (chain.length === 0) {
    return {
      ok: false,
      reason: "no_llm_configured",
      detail:
        "No LLM provider is configured. Set GROQ_API_KEY (free tier), OLLAMA_BASE_URL (local), or OPENAI_API_KEY / XAI_API_KEY / ANTHROPIC_API_KEY.",
    };
  }
  if (!(await rateOk())) {
    return {
      ok: false,
      reason: "rate_limited",
      detail: `LLM escalation is rate-limited (${maxCalls()} calls per 5 minutes; raise LLM_RATE_LIMIT_PER_5MIN).`,
    };
  }
  const t0 = Date.now();
  const failures: string[] = [];
  for (const cfg of chain) {
    const result = await callStructured(cfg, req).catch(() => null);
    if (result && result.parsed) {
      return {
        ok: true,
        provider: cfg.provider,
        model: cfg.model,
        answers: coerceAnswers(req.questions, result.parsed),
        usage: result.usage,
        latency_ms: Date.now() - t0,
      };
    }
    failures.push(cfg.provider);
  }
  return {
    ok: false,
    reason: "llm_error",
    detail: `Every configured LLM provider failed (${failures.join(", ")}).`,
  };
}

export async function runLlm(
  req: SystemOneRequest,
): Promise<SystemOneResponse> {
  const result = await escalateToLlm(req);
  if (result.ok) {
    return {
      model: LLM_MODEL,
      answers: result.answers,
      usage: result.usage,
      latency_ms: result.latency_ms,
    };
  }
  if (result.reason === "rate_limited") {
    throw new Error(
      "The LLM escalation backend is rate-limited on this deployment. Use system-one (local) or try again in a few minutes.",
    );
  }
  const local = runLocal(req, LOCAL_MODEL);
  return {
    ...local,
    model: LOCAL_MODEL,
    fallback: {
      requested: LLM_MODEL,
      served: LOCAL_MODEL,
      reason: result.reason,
      detail: result.detail,
    },
  };
}

async function callStructured(
  cfg: ProviderConfig,
  req: SystemOneRequest,
): Promise<ProviderResult | null> {
  // Only the typed contract goes to the provider (no trust-extension knobs).
  const questions: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(req.questions)) {
    questions[id] = { type: q.type, instructions: q.instructions, criteria: q.criteria };
  }
  const payload = JSON.stringify({ state: req.state, questions });
  if (cfg.provider === "anthropic") {
    return callAnthropicStructured(cfg, payload);
  }
  return callOpenAiCompatibleStructured(cfg, payload);
}

/** OpenAI + xAI (Grok) both speak the `chat/completions` wire format. */
async function callOpenAiCompatibleStructured(
  cfg: ProviderConfig,
  payload: string,
): Promise<ProviderResult | null> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: 0,
    max_tokens: 700,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: payload },
    ],
  };
  if (cfg.provider === "xai") body.reasoning_effort = "low";
  if (cfg.provider === "ollama") body.stream = false;

  const json = await postOpenAiChat(cfg, body);
  if (!json) return null;
  const text = json.choices?.[0]?.message?.content ?? "";
  return {
    parsed: parseLlm(text),
    usage: {
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
    },
  };
}

const ANSWERS_TOOL = {
  name: "return_answers",
  description:
    "Return calibrated typed answers, one per question id, as Choice / Score / Noul rows.",
  input_schema: {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["choice", "score", "noul"] },
            id: { type: "string" },
            probabilities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  option: { type: "string" },
                  level: { type: "number" },
                  p: { type: "number" },
                },
              },
            },
            score: { type: "number" },
            noul: { type: "number" },
            confidence: { type: "number" },
          },
          required: ["type", "id"],
        },
      },
    },
    required: ["answers"],
  },
} as const;

/** Anthropic returns the typed answers via a forced tool call. */
async function callAnthropicStructured(
  cfg: ProviderConfig,
  payload: string,
): Promise<ProviderResult | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(cfg.apiKey),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1024,
        system: SYSTEM,
        tools: [ANSWERS_TOOL],
        tool_choice: { type: "tool", name: ANSWERS_TOOL.name },
        messages: [{ role: "user", content: payload }],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      content?: { type: string; name?: string; input?: unknown }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const block = json.content?.find(
      (b) => b.type === "tool_use" && b.name === ANSWERS_TOOL.name,
    );
    return {
      parsed: block ? asLlmOut(block.input) : null,
      usage: {
        input_tokens: json.usage?.input_tokens ?? 0,
        output_tokens: json.usage?.output_tokens ?? 0,
      },
    };
  } catch {
    return null;
  }
}

function asLlmOut(value: unknown): LlmOut | null {
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as LlmOut).answers)
  ) {
    return value as LlmOut;
  }
  return null;
}

function parseLlm(text: string): LlmOut | null {
  try {
    return asLlmOut(JSON.parse(text));
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return asLlmOut(JSON.parse(text.slice(start, end + 1)));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function coerceAnswers(
  questions: Record<string, Question>,
  parsed: LlmOut | null,
): Record<string, Answer> {
  const byId = new Map<string, LlmOut["answers"][number]>();
  if (parsed) {
    for (const a of parsed.answers) {
      if (a && typeof a.id === "string") byId.set(a.id, a);
    }
  }
  const out: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const raw = byId.get(id);
    if (q.type === "noul") {
      const n =
        raw && raw.type === "noul" && typeof raw.noul === "number"
          ? raw.noul
          : 0.5;
      out[id] = { type: "noul", noul: round4(clamp(n)) };
      continue;
    }
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const probs: Record<string, number> = {};
      if (raw && raw.type === "choice" && Array.isArray(raw.probabilities)) {
        for (const row of raw.probabilities) {
          if (keys.includes(row.option)) probs[row.option] = Math.max(0, row.p);
        }
      }
      for (const k of keys) if (probs[k] === undefined) probs[k] = 0;
      const values = keys.map((k) => probs[k] ?? 0);
      const norm = softmax(
        values.map((v) => Math.log(Math.max(v, 1e-8))),
        1,
      );
      keys.forEach((k, i) => {
        probs[k] = round4(norm[i] ?? 0);
      });
      let best = keys[0] ?? "";
      for (const k of keys) if ((probs[k] ?? 0) > (probs[best] ?? 0)) best = k;
      out[id] = {
        type: "choice",
        choice: best,
        probabilities: probs,
        confidence: round4(
          typeof raw === "object" &&
            raw &&
            raw.type === "choice" &&
            typeof raw.confidence === "number"
            ? clamp(raw.confidence)
            : peakedConfidence(norm),
        ),
      };
      continue;
    }
    const n = q.criteria.length;
    const probs: Record<string, number> = {};
    if (raw && raw.type === "score" && Array.isArray(raw.probabilities)) {
      for (const row of raw.probabilities) {
        const k = String(row.level);
        if (Number(k) >= 0 && Number(k) < n) probs[k] = Math.max(0, row.p);
      }
    }
    for (let i = 0; i < n; i++)
      if (probs[String(i)] === undefined) probs[String(i)] = 0;
    const values = Array.from({ length: n }, (_, i) => probs[String(i)] ?? 0);
    const norm = softmax(
      values.map((v) => Math.log(Math.max(v, 1e-8))),
      1,
    );
    let expected = 0;
    const legend: Record<string, EntryType> = {};
    for (let i = 0; i < n; i++) {
      probs[String(i)] = round4(norm[i] ?? 0);
      legend[String(i)] = q.criteria[i] ?? "";
      expected += i * (norm[i] ?? 0);
    }
    out[id] = {
      type: "score",
      score: round4(
        raw && raw.type === "score" && typeof raw.score === "number"
          ? raw.score
          : expected,
      ),
      legend,
      probabilities: probs,
      confidence: round4(
        raw && raw.type === "score" && typeof raw.confidence === "number"
          ? clamp(raw.confidence)
          : peakedConfidence(norm),
      ),
    };
  }
  return out;
}

function clamp(n: number) {
  return Math.min(1, Math.max(0, n));
}

const SYSTEM = `You are OpenJev, a System One decision model. You never write prose, never invent options, never add fields.

Given STATE and QUESTIONS, return calibrated probabilities as JSON:
{"answers":[...]}

Each answer MUST include the question id.

- type "choice": {"type":"choice","id":"...","probabilities":[{"option":"<exact key>","p":0-1},...],"confidence":0-1}
  Use EXACTLY the given option keys. Probabilities sum to 1. confidence is how peaked the distribution is.
- type "score": {"type":"score","id":"...","probabilities":[{"level":0,"p":0-1},...],"score":<expected value>,"confidence":0-1}
  Levels are 0..n-1 in the given order. score is the probability-weighted level.
- type "noul": {"type":"noul","id":"...","noul":0-1}
  Probability the answer is yes. 0.5 = unknown, 0.9+ = clear yes, 0.1- = clear no.

Questions are independent. If the state is unrelated, spread probability / return ~0.5 noul.

CALIBRATION (match confidence to the strength of the evidence in STATE):
- Thin / ambiguous / off-topic evidence -> keep the distribution flat and confidence MODERATE.
- Strong, on-point, unambiguous evidence -> concentrate probability and use HIGH confidence.
- Never report near-1.0 confidence unless the state makes one answer nearly certain.

Calibrated examples (illustrative; use the real ids and option keys from QUESTIONS):

Thin evidence (STATE barely mentions the topic) -> moderate, spread:
{"answers":[
  {"type":"choice","id":"intent","probabilities":[{"option":"bug","p":0.4},{"option":"feature","p":0.35},{"option":"question","p":0.25}],"confidence":0.42},
  {"type":"score","id":"severity","probabilities":[{"level":0,"p":0.3},{"level":1,"p":0.4},{"level":2,"p":0.3}],"score":1.0,"confidence":0.4},
  {"type":"noul","id":"is_urgent","noul":0.55}
]}

Strong evidence (STATE clearly and directly supports one answer) -> peaked, high:
{"answers":[
  {"type":"choice","id":"intent","probabilities":[{"option":"bug","p":0.92},{"option":"feature","p":0.05},{"option":"question","p":0.03}],"confidence":0.9},
  {"type":"score","id":"severity","probabilities":[{"level":0,"p":0.02},{"level":1,"p":0.08},{"level":2,"p":0.9}],"score":1.88,"confidence":0.88},
  {"type":"noul","id":"is_urgent","noul":0.94}
]}

Be calibrated. Do not be overconfident on thin evidence.`;

/**
 * Free-form generation helper (used by cookbooks). Provider-agnostic: routes to
 * the active provider's chat/messages endpoint and returns the raw text.
 */
export async function llmGenerate(opts: {
  system: string;
  user: string;
  max_tokens?: number;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const cfg = resolveProvider();
  if (!cfg) return { ok: false, error: "unavailable" };
  if (!(await rateOk())) return { ok: false, error: "rate-limited" };
  try {
    const text =
      cfg.provider === "anthropic"
        ? await anthropicGenerate(cfg, opts)
        : await openAiCompatibleGenerate(cfg, opts);
    if (text === null) return { ok: false, error: `${cfg.provider} request failed` };
    return { ok: true, text };
  } catch {
    return { ok: false, error: "network" };
  }
}

async function openAiCompatibleGenerate(
  cfg: ProviderConfig,
  opts: { system: string; user: string; max_tokens?: number },
): Promise<string | null> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: 0,
    max_tokens: opts.max_tokens ?? 180,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (cfg.provider === "xai") body.reasoning_effort = "low";
  const json = await postOpenAiChat(cfg, body);
  if (!json) return null;
  return json.choices?.[0]?.message?.content ?? "";
}

async function anthropicGenerate(
  cfg: ProviderConfig,
  opts: { system: string; user: string; max_tokens?: number },
): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: anthropicHeaders(cfg.apiKey),
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: opts.max_tokens ?? 180,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  return (
    json.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("") ?? ""
  );
}
