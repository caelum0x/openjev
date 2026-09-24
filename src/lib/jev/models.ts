import type { EngineWeights } from "./types.ts";

export type ModelBackend =
  | "auto"
  | "local"
  | "llm"
  | "laya"
  | "cloud"
  | "otsone";

/**
 * `family` (descriptive) groups a card by what actually computes it. The local
 * cards are all one engine run with different scalar weights, so they share the
 * honest family "Tuning profile" — NOT four separate training runs; the otsone
 * cards are our own neural model ("OpenJev"). See model-cards.ts.
 */
export type ModelFamily =
  | "Tuning profile"
  | "Laya"
  | "LLM"
  | "Cloud"
  | "OpenJev";

/**
 * `familyId` is the top-level MODEL FAMILY a user chooses on /models: one of the
 * three backends OpenJev routes to. Every catalog id belongs to exactly one:
 *   - "cloud"        → the hosted OpenJev cloud tier (needs a key). Speaks the
 *                      wire-compatible System One v1 API; degrades to local unset.
 *   - "laya"         → the open-weight neural model (Laya, Convai's attributed
 *                      model) served on a local sidecar.
 *   - "openjev" → OUR OWN family: the otsone neural model (our sidecar) plus
 *                      the always-on local TF-IDF engine as its deterministic tier
 *                      and the opt-in LLM escalation.
 *
 * NOTE: the legacy id "jev" still resolves to a model in the "cloud" family via
 * the ALIASES table below, so existing wire clients never break.
 */
export type ModelFamilyId = "cloud" | "laya" | "openjev";

/** Honest availability posture for a family or model on a fresh deployment. */
export type AvailabilityPosture = "always" | "requires-key" | "requires-sidecar";

/** Presentation + honesty metadata for one of the three model families. */
export type ModelFamilyInfo = {
  id: ModelFamilyId;
  label: string;
  /** One-line description of the family the /models page renders. */
  blurb: string;
  /** What this family needs to be servable on a deployment (UI hint). */
  requirement: string;
  /**
   * Baseline posture for the family header badge. Note: the "openjev"
   * family is mixed — its deterministic tier is always on, but the otsone neural
   * tier needs a sidecar — so per-model requirements are the honest source of
   * truth (see `backendRequirement`), and this is only the headline.
   */
  availability: AvailabilityPosture;
};

/** The three families, ordered ours-first → open-weight → hosted cloud. */
export const MODEL_FAMILIES: ModelFamilyInfo[] = [
  {
    id: "openjev",
    label: "OpenJev",
    blurb:
      "Our own family. The otsone neural model (otsone-base) served over our sidecar, backed by the always-on local System One engine (sentence embeddings when the small encoder is installed, else the zero-dependency TF-IDF engine) as its deterministic tier — plus an opt-in escalation to a hosted LLM. Nothing here requires a cloud account: the deterministic tier ships in the app.",
    requirement:
      "Deterministic tier is always on; the otsone neural models need the otsone sidecar",
    availability: "always",
  },
  {
    id: "laya",
    label: "Neural (Laya)",
    blurb:
      "An open-weight neural typed-decision model, served by a local sidecar (the underlying weights are Laya, Convai's attributed model): laya-mlx on Apple Silicon, laya-onnx on Linux/CPU. Native bidirectional Choice / Score / Noul, 0 output tokens, no data leaves the box.",
    requirement: "Requires the neural (Laya) sidecar (LAYA_ENGINE_URL)",
    availability: "requires-sidecar",
  },
  {
    id: "cloud",
    label: "OpenJev Cloud",
    blurb:
      "The hosted OpenJev tier. Proxies the same typed questions to your configured cloud endpoint over the wire-compatible System One v1 API — the highest-capability tier, run as a service. Needs a key and endpoint, and degrades to the local engine when unset.",
    requirement: "Requires OPENJEV_API_KEY (and a cloud endpoint)",
    availability: "requires-key",
  },
];

export function familyInfo(id: ModelFamilyId): ModelFamilyInfo {
  const found = MODEL_FAMILIES.find((f) => f.id === id);
  // MODEL_FAMILIES covers every ModelFamilyId, so this fallback is unreachable.
  return found ?? MODEL_FAMILIES[0]!;
}

export type ModelCard = {
  id: string;
  label: string;
  /** Descriptive sub-tier label (e.g. "Tuning profile", "OpenJev"). */
  family: ModelFamily;
  /** Top-level family the user chooses: jev | laya | openjev. */
  familyId: ModelFamilyId;
  backend: ModelBackend;
  blurb: string;
  playground: boolean;
};

export const DEFAULT_MODEL = "system-one";
// Canonical id for the escalation model. Kept as `openjev-grok` for
// backward compatibility; the backend is now any provider (OpenAI / xAI / Anthropic).
export const LLM_MODEL = "openjev-grok";
export const LAYA_MLX_MODEL = "laya-mlx";
export const LAYA_ONNX_MODEL = "laya-onnx";
// Canonical id for the hosted OpenJev cloud backend (wire-compatible with
// the upstream System One v1 API). Only used when a request explicitly selects it
// (or via configured escalation); it is NOT part of the default chain, and
// degrades to local when no key is set. The legacy id value is kept for wire
// back-compat; `CLOUD_MODEL` is the de-branded canonical export.
export const CLOUD_MODEL = "system-one-cloud";
/** @deprecated Back-compat alias for {@link CLOUD_MODEL}. */
export const TYPESAFE_CLOUD_MODEL = CLOUD_MODEL;
// Canonical ids for OUR OWN neural family (otsone). Served by the otsone sidecar
// (OTSONE_MODEL_URL / OTSONE_BACKEND) running our `otsone-base` ONNX model; they
// health-gate to the local TF-IDF engine when the sidecar is absent.
export const OTSONE_MODEL = "otsone-1";
/**
 * The cascade: the local tier (otsone sidecar when healthy, else the System One
 * engine) answers every question; questions whose confidence falls below the
 * escalation threshold (or that are out of scope) are re-asked to the LLM chain
 * (Groq / Ollama / OpenAI-if-keyed). Cheap when sure, smart when not.
 */
export const AUTO_MODEL = "auto";
export const OTSONE_MINI_MODEL = "otsone-mini";

const SYSTEM_ONE: EngineWeights = {
  lex: 1.15,
  fuzzy: 0.72,
  dist: 1.95,
  keyHit: 1.4,
  descHit: 1.05,
  syn: 1.5,
  ex: 1.7,
  bigram: 1.25,
  neg: 1.55,
  tempScale: 1,
  noulTempFloor: 0.4,
  peakedBlend: 0.55,
};

// The three non-baseline profiles are the SAME engine with different scalars.
// Honest names describe what the scalars do; see model-cards.ts for measured
// deltas and PARAM_GLOSSARY for what each knob changes.

// "Sharp" (id jev-v13): a hair colder/peakier than Balanced. A compat pin.
const SHARP: EngineWeights = {
  ...SYSTEM_ONE,
  tempScale: 0.94,
  peakedBlend: 0.58,
  dist: 1.85,
};

// "Decisive" (was `rlhf`): coldest temperature -> most confident argmax.
// NOT a preference-learning run — just a lower tempScale + higher peakedBlend.
const DECISIVE: EngineWeights = {
  ...SYSTEM_ONE,
  tempScale: 0.72,
  dist: 1.7,
  peakedBlend: 0.68,
  noulTempFloor: 0.34,
};

// "Contrastive" (was `rlcd`): down-weights surface overlap, up-weights
// distinctive tokens + the not_for penalty. Not contrastive *distillation* —
// just a re-weighting of the same lexical features.
const CONTRASTIVE: EngineWeights = {
  ...SYSTEM_ONE,
  lex: 0.9,
  fuzzy: 0.55,
  dist: 2.5,
  syn: 1.1,
  tempScale: 0.88,
  peakedBlend: 0.6,
  neg: 1.8,
};

export const MODEL_CARDS: ModelCard[] = [
  // ── The cascade: local first, LLM only when unsure ──
  {
    id: AUTO_MODEL,
    label: "Auto (cascade)",
    family: "OpenJev",
    familyId: "openjev",
    backend: "auto",
    blurb:
      "Answers locally (otsone when its sidecar is up, else the System One engine) and escalates only low-confidence or out-of-scope questions to an LLM (Groq free tier, local Ollama, or OpenAI when keyed). Every response records which questions escalated and why. Without an LLM configured it stays local and says so.",
    playground: true,
  },
  // ── OpenJev family — our own neural model + its deterministic tier ──
  {
    id: OTSONE_MODEL,
    label: "OpenJev One (otsone-1)",
    family: "OpenJev",
    familyId: "openjev",
    backend: "otsone",
    blurb:
      "Our own neural typed-decision model, otsone-base, served over the otsone / ONNX sidecar. Native bidirectional Choice / Score / Noul, 0 output tokens, trained in-house (the laya-mlx pipeline). Measured model card is pending the first release; falls back to the local engine when the sidecar is absent.",
    playground: true,
  },
  {
    id: OTSONE_MINI_MODEL,
    label: "OpenJev Mini (otsone-mini)",
    family: "OpenJev",
    familyId: "openjev",
    backend: "otsone",
    blurb:
      "A smaller, faster otsone checkpoint for CPU-bound and high-throughput serving. Same typed contract and same sidecar as otsone-1. Measured model card pending; health-gated to the local engine.",
    playground: true,
  },
  {
    id: "system-one",
    label: "System One (Balanced)",
    family: "Tuning profile",
    familyId: "openjev",
    backend: "local",
    blurb:
      "The default. With the 33 MB gte-small model installed (npm run embed-download) it runs the sentence-embedding engine on CPU: nearest-prototype matching over your options, a fitted out-of-scope detector, and temperatures fitted on held-out data. Without it, the lexical (TF-IDF) engine answers and the response says so in `engine`. Public-dataset accuracy and ECE for both are on /leaderboard.",
    playground: true,
  },
  {
    id: "jev-v13",
    label: "Sharp (v13)",
    family: "Tuning profile",
    familyId: "openjev",
    backend: "local",
    blurb:
      "A hair sharper than Balanced (tempScale 0.94). Same decisions, marginally more peaked — a compatibility pin, not a separate model version. The id `jev-v13` is kept for wire back-compat.",
    playground: true,
  },
  {
    id: "decisive",
    label: "Decisive",
    family: "Tuning profile",
    familyId: "openjev",
    backend: "local",
    blurb:
      "Coldest temperature (tempScale 0.72): most confident argmax, least hedging. A tuning profile over one engine — not a preference-learning run. Was `rlhf`.",
    playground: true,
  },
  {
    id: "contrastive",
    label: "Contrastive",
    family: "Tuning profile",
    familyId: "openjev",
    backend: "local",
    blurb:
      "Down-weights surface overlap, up-weights distinctive tokens and the not_for penalty (dist 2.5, neg 1.8). Feature re-weighting, not contrastive distillation. Was `rlcd`.",
    playground: true,
  },
  {
    id: "openjev-grok",
    label: "Escalate (LLM)",
    family: "LLM",
    familyId: "openjev",
    backend: "llm",
    blurb:
      "The OpenJev family's escalation tier: hand the same typed questions to a hosted LLM (OpenAI, xAI Grok, or Anthropic) when local confidence is thin. Metered and opt-in.",
    playground: false,
  },
  // ── Laya family — Convai's open-weight neural model on a local sidecar ──
  {
    id: "laya-mlx",
    label: "Laya (MLX)",
    family: "Laya",
    familyId: "laya",
    backend: "laya",
    blurb:
      "Open-weight typed-decision model on Apple MLX. Native bidirectional Choice / Score / Noul, 0 output tokens.",
    playground: true,
  },
  {
    id: "laya-onnx",
    label: "Laya (ONNX)",
    family: "Laya",
    familyId: "laya",
    backend: "laya",
    blurb:
      "Same Laya typed-decision weights on the Linux / CPU ONNX runtime. Local, no cloud API.",
    playground: true,
  },
  // ── Cloud family — the hosted OpenJev cloud tier ──
  {
    id: CLOUD_MODEL,
    label: "OpenJev Cloud",
    family: "Cloud",
    familyId: "cloud",
    backend: "cloud",
    blurb:
      "Proxy the same typed questions to the hosted OpenJev cloud endpoint over the wire-compatible System One v1 API. Needs OPENJEV_API_KEY and a cloud endpoint; degrades to the local engine when unset.",
    playground: false,
  },
];

const ALIASES: Record<string, string> = {
  auto: AUTO_MODEL,
  cascade: AUTO_MODEL,
  "openjev-auto": AUTO_MODEL,
  "jev-latest": "system-one",
  "jev-1.12": "jev-v13",
  "openjev-fast": "system-one",
  jev: "system-one",
  systemone: "system-one",
  system_one: "system-one",
  balanced: "system-one",
  sharp: "jev-v13",
  // Honest-name canonical ids; the old training-implying names still resolve.
  rlhf: "decisive",
  "rl-hf": "decisive",
  rlcd: "contrastive",
  "rl-cd": "contrastive",
  "openjev-grok": "openjev-grok",
  "openjev-llm": "openjev-grok",
  "jev-grok": "openjev-grok",
  grok: "openjev-grok",
  llm: "openjev-grok",
  escalate: "openjev-grok",
  "laya-mlx": "laya-mlx",
  "laya-onnx": "laya-onnx",
  laya: "laya-mlx",
  "laya-multilingual": "laya-mlx",
  "system-one-cloud": CLOUD_MODEL,
  cloud: CLOUD_MODEL,
  "openjev-cloud": CLOUD_MODEL,
  // Back-compat cloud aliases (legacy brand ids still resolve).
  "jev-cloud": CLOUD_MODEL,
  "typesafe-cloud": CLOUD_MODEL,
  "jev-hosted": CLOUD_MODEL,
  // OUR OWN otsone family.
  "otsone-1": OTSONE_MODEL,
  "otsone-mini": OTSONE_MINI_MODEL,
  otsone: OTSONE_MODEL,
  otsone1: OTSONE_MODEL,
  "otsone-base": OTSONE_MODEL,
  "openjev-one": OTSONE_MODEL,
  "openjev-mini": OTSONE_MINI_MODEL,
  "openjev-latest": "system-one",
  // Pre-rename (opentypesafe-*) wire ids keep resolving so existing
  // integrations work unchanged after the OpenJev rebrand.
  "opentypesafe-latest": "system-one",
  "opentypesafe-fast": "system-one",
  "opentypesafe-grok": LLM_MODEL,
  "opentypesafe-llm": LLM_MODEL,
  "opentypesafe-cloud": CLOUD_MODEL,
  "opentypesafe-one": OTSONE_MODEL,
  "opentypesafe-mini": OTSONE_MINI_MODEL,
};

const WEIGHTS: Record<string, EngineWeights> = {
  "system-one": SYSTEM_ONE,
  "jev-v13": SHARP,
  decisive: DECISIVE,
  contrastive: CONTRASTIVE,
};

export type ResolvedModel = {
  id: string;
  label: string;
  backend: ModelBackend;
  weights: EngineWeights;
};

export function canonicalModelId(raw?: string): string {
  if (!raw) return DEFAULT_MODEL;
  const key = raw.trim().toLowerCase();
  return ALIASES[key] ?? (WEIGHTS[key] ? key : key);
}

export function resolveModel(raw?: string): ResolvedModel {
  const id = canonicalModelId(raw);
  if (id === AUTO_MODEL) {
    return {
      id: AUTO_MODEL,
      label: "Auto (cascade)",
      backend: "auto",
      weights: SYSTEM_ONE,
    };
  }
  if (id === LLM_MODEL || id.startsWith("grok") || id.startsWith("llm")) {
    return {
      id: LLM_MODEL,
      label: "Escalate (LLM)",
      backend: "llm",
      weights: SYSTEM_ONE,
    };
  }
  if (id === CLOUD_MODEL) {
    const card = MODEL_CARDS.find((c) => c.id === CLOUD_MODEL);
    return {
      id: CLOUD_MODEL,
      label: card?.label ?? "OpenJev Cloud",
      backend: "cloud",
      // Weights only used if the cloud key is unavailable and we fall back to local.
      weights: SYSTEM_ONE,
    };
  }
  if (id === LAYA_MLX_MODEL || id === LAYA_ONNX_MODEL || id.startsWith("laya")) {
    const layaId = id === LAYA_ONNX_MODEL ? LAYA_ONNX_MODEL : LAYA_MLX_MODEL;
    const card = MODEL_CARDS.find((c) => c.id === layaId);
    return {
      id: layaId,
      label: card?.label ?? "Laya",
      backend: "laya",
      // Weights only used if the sidecar is unavailable and we fall back to local.
      weights: SYSTEM_ONE,
    };
  }
  if (id === OTSONE_MODEL || id === OTSONE_MINI_MODEL || id.startsWith("otsone")) {
    const otsoneId = id === OTSONE_MINI_MODEL ? OTSONE_MINI_MODEL : OTSONE_MODEL;
    const card = MODEL_CARDS.find((c) => c.id === otsoneId);
    return {
      id: otsoneId,
      label: card?.label ?? "OpenJev One",
      backend: "otsone",
      // Weights only used if the sidecar is unavailable and we fall back to local.
      weights: SYSTEM_ONE,
    };
  }
  const card = MODEL_CARDS.find((c) => c.id === id);
  const weights = WEIGHTS[id] ?? SYSTEM_ONE;
  return {
    id: card?.id ?? DEFAULT_MODEL,
    label: card?.label ?? "System One",
    backend: "local",
    weights,
  };
}

/** Per-model availability, as reported by GET /api/v1/status. Client-safe. */
export type ModelAvailability = {
  id: string;
  backend: ModelBackend;
  /** True when this exact model can be served on this deployment right now. */
  available: boolean;
  /** Why it is unavailable (machine-oriented), when `available` is false. */
  reason?: string;
  /** How to make it available (UI hint), when `available` is false. */
  install?: string;
};

/** Aggregate backend/sidecar status, as reported by GET /api/v1/status. */
export type BackendStatusResponse = {
  object: "backend_status";
  /**
   * The always-on in-process engine. `engine` says which one serves
   * `system-one`: the embedding engine when its model is installed, else the
   * lexical engine (with the reason).
   */
  local: {
    available: true;
    engine: "embedding" | "lexical";
    encoder?: string;
    reason?: string;
  };
  /** Native C++/Rust kernel sidecar (OPENJEV_ENGINE_URL). */
  native: { available: boolean; url: string; engine?: string };
  /** Laya neural sidecar (LAYA_ENGINE_URL); `backend` is the active variant. */
  laya: {
    available: boolean;
    backend: "mlx" | "onnx";
    url: string;
    engine?: string;
  };
  /** OUR OWN otsone neural sidecar (OTSONE_MODEL_URL); `backend` is the variant. */
  otsone: {
    available: boolean;
    backend: string;
    url: string;
    engine?: string;
  };
  /** Whether any hosted LLM provider key is configured (escalation backend). */
  llm: { available: boolean };
  /** Whether the hosted OpenJev cloud key is configured. */
  cloud: { available: boolean };
  /** One row per catalog model, gating the UI selector. */
  models: ModelAvailability[];
};

export function isLlmModel(model?: string): boolean {
  return resolveModel(model).backend === "llm";
}

export function isLayaModel(model?: string): boolean {
  return resolveModel(model).backend === "laya";
}

export function isCloudModel(model?: string): boolean {
  return resolveModel(model).backend === "cloud";
}

/** @deprecated Back-compat alias for {@link isCloudModel}. */
export const isTypeSafeCloudModel = isCloudModel;

export function isOtsoneModel(model?: string): boolean {
  return resolveModel(model).backend === "otsone";
}
