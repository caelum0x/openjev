export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** TypeSafe EntryType: instructions and criteria accept any JSON. */
export type EntryType = JsonValue;

export type State = string | Record<string, unknown> | unknown[];

/**
 * Options every question type accepts on top of its typed contract. All are
 * optional extensions to the System One v1 wire format; clients that do not
 * send them get byte-for-byte the classic behaviour.
 */
export type QuestionExtensions = {
  /**
   * Opt into abstention ("I don't know"). When the input is out of scope or
   * the answer's confidence is below `abstain_below`, the answer comes back
   * with `abstained: true` (choice answers pick the reserved `__none__`).
   */
  abstain?: boolean;
  /** Confidence floor for abstention (0-1). Implies `abstain: true`. */
  abstain_below?: number;
  /**
   * `auto` model only: escalate this question to the LLM when its local
   * confidence is below this value (0-1). Overrides the request default.
   */
  escalate_below?: number;
};

export type NoulQuestion = QuestionExtensions & {
  type: "noul";
  instructions: EntryType;
  criteria?: {
    true?: EntryType;
    false?: EntryType;
  };
};

export type ChoiceQuestion = QuestionExtensions & {
  type: "choice";
  instructions: EntryType;
  criteria: Record<string, EntryType>;
};

export type ScoreQuestion = QuestionExtensions & {
  type: "score";
  instructions: EntryType;
  criteria: EntryType[];
};

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

/**
 * Trust fields every answer may carry (all optional on the wire):
 *  - `ood`: out-of-scope score in [0,1] (distance + entropy based).
 *  - `abstained` / `abstain_reason` / `p_none`: set only when the question
 *    opted into abstention and the model said "I don't know".
 *  - `calibrated`: true when a customer calibration map rewrote confidence.
 *  - `escalated`: true when the `auto` model re-asked this question to an LLM.
 */
export type AnswerTrust = {
  ood?: number;
  abstained?: boolean;
  abstain_reason?: "out_of_scope" | "low_confidence";
  p_none?: number;
  calibrated?: boolean;
  escalated?: boolean;
};

export type NoulAnswer = AnswerTrust & {
  type: "noul";
  noul: number;
};

export type ChoiceAnswer = AnswerTrust & {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type ScoreAnswer = AnswerTrust & {
  type: "score";
  score: number;
  legend: Record<string, EntryType>;
  probabilities: Record<string, number>;
  confidence: number;
};

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type SystemOneRequest = {
  model?: string;
  state: State;
  questions: Questions;
  /** Request-wide abstention default (see QuestionExtensions.abstain). */
  abstain?: boolean;
  /** Request-wide abstention confidence floor (0-1). */
  abstain_below?: number;
  /** `auto` model: request-wide escalation threshold (0-1). */
  escalate_below?: number;
  /** Apply this customer calibration map (see POST /v1/calibrations). */
  calibration_id?: string;
};

/**
 * Set ONLY when the requested backend was unavailable and the decision was
 * served by a different (always-on local) backend instead. Its presence is the
 * honest, machine-readable signal that the answer is NOT from the model named in
 * `model` originally requested — e.g. a `laya-*` request whose sidecar was not
 * installed. Absent on the normal path.
 */
export type SystemOneFallback = {
  /** The backend / model id the caller asked for. */
  requested: string;
  /** The backend / model id that actually produced the answer. */
  served: string;
  /** Stable machine-readable reason, e.g. `laya_sidecar_unavailable`. */
  reason: string;
  /** Human-readable, UI-safe explanation. */
  detail: string;
};

/**
 * Present on `auto` responses: which questions the local tier answered, which
 * escalated to an LLM, and why. `provider`/`llm_model` name the LLM used.
 */
export type SystemOneEscalation = {
  /** Local model that answered first (e.g. `otsone-1` or `system-one`). */
  local_model: string;
  /** Question ids re-asked to the LLM. */
  escalated: string[];
  /** Question ids kept from the local tier. */
  kept: string[];
  /** Threshold used (per-question overrides are reflected in `escalated`). */
  threshold: number;
  /** LLM provider used, or null when escalation could not run. */
  provider: string | null;
  llm_model: string | null;
  /** Question ids that needed escalation but were kept local (escalation did not run). */
  needed?: string[];
  /** Why escalation was skipped/failed, when it was needed but did not run. */
  skipped_reason?: "no_llm_configured" | "rate_limited" | "llm_error";
  /** LLM token usage attributable to the escalation. */
  llm_usage?: { input_tokens: number; output_tokens: number };
};

/** Present when a customer calibration map was applied. */
export type SystemOneCalibrationApplied = {
  id: string;
  method: "temperature" | "isotonic";
  /** Question ids whose confidence was remapped. */
  questions: string[];
  /** Set when the map was NOT applied (e.g. fitted on a different model). */
  skipped_reason?: string;
};

/**
 * Which local engine produced a `system-one` answer. `embedding` is the
 * sentence-embedding engine (default when its model file is installed);
 * `lexical` is the always-available TF-IDF engine, with the reason the
 * embedding engine did not run.
 */
export type SystemOneEngine =
  | {
      kind: "embedding";
      encoder: string;
      /** Encoder id + fitted-constants fingerprint; calibration maps are keyed on it. */
      version?: string;
    }
  | { kind: "lexical"; reason?: string };

export type SystemOneResponse = {
  model: string;
  /** Local engine capability flag (present on `system-one` answers). */
  engine?: SystemOneEngine;
  answers: Record<string, Answer>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  latency_ms: number;
  fallback?: SystemOneFallback;
  escalation?: SystemOneEscalation;
  calibration?: SystemOneCalibrationApplied;
};

export type SystemOneError = {
  error: {
    type: string;
    message: string;
  };
};

export type EngineWeights = {
  lex: number;
  fuzzy: number;
  dist: number;
  keyHit: number;
  descHit: number;
  syn: number;
  ex: number;
  bigram: number;
  neg: number;
  tempScale: number;
  noulTempFloor: number;
  peakedBlend: number;
};

export const LOCAL_MODEL = "system-one";
export const GROK_MODEL = "openjev-grok";
export const JEV_LATEST = "jev-latest";

export function stateToText(state: State): string {
  return stateProse(state);
}

/** Flatten state into readable prose so field names participate in matching. */
export function stateProse(value: unknown, depth = 0): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => stateProse(v, depth + 1))
      .filter(Boolean)
      .join(depth === 0 ? "\n" : ", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const label = k.replace(/_/g, " ");
        const inner = stateProse(v, depth + 1);
        if (!inner) return "";
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          return `${label}: ${inner}`;
        }
        return `${label}: ${inner}`;
      })
      .filter(Boolean)
      .join(depth === 0 ? "\n" : "; ");
  }
  return String(value);
}

export function approxTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words * 1.35 + text.length / 18));
}

export function legendLabel(entry: EntryType): string {
  if (entry == null) return "";
  if (typeof entry === "string") return entry;
  if (typeof entry === "number" || typeof entry === "boolean") return String(entry);
  if (Array.isArray(entry)) return entry.map(legendLabel).filter(Boolean).join(", ");
  const o = entry as Record<string, JsonValue>;
  const primary = o.what ?? o.summary ?? o.description ?? o.question;
  if (primary != null) return legendLabel(primary);
  return stateProse(entry);
}
