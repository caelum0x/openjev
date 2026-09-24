/**
 * Out-of-scope (OOD) detection + abstention ("I don't know").
 *
 * Jev-style System One models happily answer questions about inputs they were
 * never meant to judge — independent tests found 0 of 30 out-of-scope inputs
 * flagged, at 0.99 confidence. This module gives every answer, from every
 * backend, an honest out-of-scope score and lets callers opt into abstention.
 *
 * Two backend-agnostic signals are combined:
 *
 *  1. DISTANCE — how far the state is from the question's vocabulary. We compare
 *     the state against the question text (instructions + every option /
 *     level / criterion) with synonym-expanded token overlap and character
 *     trigram similarity. A state that shares nothing with any option is far
 *     from the question's support; that is what "out of scope" means for a
 *     typed decision.
 *  2. ENTROPY — how flat the answer distribution is. A flat distribution on a
 *     distant input is the classic OOD signature; a peaked distribution on a
 *     distant input is exactly the over-confident failure we must NOT trust, so
 *     distance dominates and entropy only modulates.
 *
 * The result `ood` in [0,1] is attached to each answer. Non-LLM answers are
 * then damped toward uncertainty in proportion to `ood` (confidence scaled
 * down, noul pulled toward 0.5), so an off-topic input can no longer come back
 * at 0.99. Abstention is opt-in per question (`abstain: true`) or per request
 * (`abstain: true` / `abstain_below`), and applies to all three question types.
 *
 * Pure and dependency-free (runs in the browser playground, the server, and
 * node:test) — no DB, no network.
 */
import { flattenEntry } from "./entry.ts";
import { expandTokens } from "./lexicon.ts";
import {
  stateProse,
  type Answer,
  type ChoiceAnswer,
  type EntryType,
  type Question,
  type ScoreAnswer,
  type State,
  type SystemOneRequest,
} from "./types.ts";
import { charNgrams, clamp01, cosine, entropy, round4, tokenize } from "./vector.ts";

/** Reserved option key for "none of the above / I don't know". */
export const NONE_OPTION = "__none__";

/** Default confidence floor below which an abstain-enabled question abstains. */
export const DEFAULT_ABSTAIN_BELOW = 0.35;

/** `ood` at or above this is reported as out of scope (and abstains if enabled). */
export const OOD_THRESHOLD = 0.6;

/**
 * Character-trigram cosine that ANY two English snippets reach by chance
 * (shared function-word fragments like " th", "ing", "the"). Similarity is
 * measured above this floor so unrelated prose does not look relevant.
 */
const FUZZY_FLOOR = 0.12;
/** Fuzzy similarity span (above the floor) that counts as fully relevant. */
const FUZZY_SPAN = 0.3;
/** Shared content tokens needed for the token signal to saturate. */
const TOKEN_SATURATION = 1.0;
/**
 * Damping ramp: answers with `ood` below DAMP_START are untouched, and damping
 * reaches full strength at DAMP_START + DAMP_SPAN. Chosen on the gold suite +
 * an off-topic probe set so every in-scope gold case keeps its answer while
 * off-topic inputs lose their spurious confidence (see scope.test.ts).
 */
const DAMP_START = 0.5;
const DAMP_SPAN = 0.35;

export type AbstainReason = "out_of_scope" | "low_confidence";

export type ScopeSignal = {
  /** Out-of-scope score in [0,1]; higher = further from the question. */
  ood: number;
  /** 1 - distance-only relevance (before entropy modulation), for debugging. */
  distance: number;
  /** Normalised entropy of the answer distribution in [0,1] (1 = flat). */
  entropy: number;
};

/** Flatten a question's own vocabulary (instructions + all options/levels). */
export function questionText(q: Question): string {
  const parts: string[] = [flattenEntry(q.instructions).text];
  if (q.type === "choice") {
    for (const [k, v] of Object.entries(q.criteria)) {
      parts.push(k.replace(/_/g, " "));
      parts.push(flattenEntry(v as EntryType).text);
    }
  } else if (q.type === "score") {
    for (const c of q.criteria) parts.push(flattenEntry(c).text);
  } else if (q.criteria) {
    parts.push(flattenEntry(q.criteria.true ?? null).text);
    parts.push(flattenEntry(q.criteria.false ?? null).text);
  }
  return parts.filter(Boolean).join(" \n ");
}

/**
 * Distance-based relevance of `stateText` to question `q`, in [0,1]
 * (1 = squarely on topic, 0 = shares nothing with the question).
 */
export function relevance(stateText: string, q: Question): number {
  return relevanceToText(stateText, questionText(q));
}

/**
 * Relevance of `stateText` to an arbitrary vocabulary text (a question, or the
 * union of every question in a request — the application's "domain").
 */
export function relevanceToText(stateText: string, vocabText: string): number {
  const stateTokens = [...new Set(tokenize(stateText))].filter((t) => t.length >= 3);
  if (stateTokens.length === 0) return 0;

  const qVocab = new Set(expandTokens(tokenize(vocabText)));
  let hits = 0;
  for (const t of stateTokens) {
    if (qVocab.has(t)) {
      hits += 1;
      continue;
    }
    // Synonym bridge from the state side (e.g. "charged" -> "billing").
    const exp = expandTokens([t]);
    if (exp.some((e) => e !== t && qVocab.has(e))) hits += 0.6;
  }
  const tokenRel = 1 - Math.exp(-hits / TOKEN_SATURATION);

  // Trigram similarity over CONTENT tokens only (stopwords removed, stemmed), so
  // shared function-word scaffolding ("what is the ...") does not look relevant.
  const fuzzy = cosine(
    charNgrams(stateTokens.join(" ")),
    charNgrams(tokenize(vocabText).join(" ")),
  );
  const fuzzyRel = clamp01((fuzzy - FUZZY_FLOOR) / FUZZY_SPAN);

  return clamp01(Math.max(tokenRel, fuzzyRel));
}

/** Normalised entropy of a probability vector in [0,1]. */
export function normEntropy(p: readonly number[]): number {
  if (p.length <= 1) return 0;
  return clamp01(entropy([...p]) / Math.log(p.length));
}

/** The probability vector behind an answer (noul is a 2-way yes/no). */
export function answerProbs(a: Answer): number[] {
  if (a.type === "noul") return [a.noul, 1 - a.noul];
  return Object.entries(a.probabilities)
    .filter(([k]) => k !== NONE_OPTION)
    .map(([, v]) => v);
}

/**
 * A uniform confidence for any answer type in [0,1]. Choice/score report their
 * own `confidence`; noul's is its distance from the 0.5 "unknown" point.
 */
export function answerConfidence(a: Answer): number {
  if (a.type === "noul") return clamp01(Math.abs(a.noul - 0.5) * 2);
  return clamp01(a.confidence);
}

/**
 * The probability the answer's committed decision is right, as the model
 * reports it: choice/score `confidence`, and for noul the probability of the
 * chosen side, max(noul, 1 - noul). This is the quantity customer calibration
 * maps are fitted on and the one `auto` escalation thresholds compare against.
 */
export function decisionConfidence(a: Answer): number {
  if (a.type === "noul") return clamp01(Math.max(a.noul, 1 - a.noul));
  return clamp01(a.confidence);
}

/**
 * Combine distance and entropy into the OOD score. Distance dominates: a
 * distant input is OOD even with a peaked (over-confident) distribution; a
 * flat distribution only tops up the score of an already-distant input.
 */
export function scopeSignal(
  stateText: string,
  q: Question,
  a: Answer,
  domainRelevance = 0,
): ScopeSignal {
  const empty = !stateText.trim();
  const distance = empty ? 1 : 1 - Math.max(relevance(stateText, q), domainRelevance);
  const h = normEntropy(answerProbs(a));
  const ood = clamp01(distance * (0.8 + 0.2 * h));
  return { ood: round4(ood), distance: round4(distance), entropy: round4(h) };
}

/** Per-question abstention settings resolved from the request. */
export type AbstainPolicy = { enabled: boolean; below: number };

export function abstainPolicy(req: SystemOneRequest, q: Question): AbstainPolicy {
  const qFlag = q.abstain;
  const reqBelow = typeof req.abstain_below === "number" ? req.abstain_below : undefined;
  const qBelow = typeof q.abstain_below === "number" ? q.abstain_below : undefined;
  const enabled = qFlag ?? req.abstain ?? (reqBelow !== undefined || qBelow !== undefined);
  return { enabled: Boolean(enabled), below: qBelow ?? reqBelow ?? DEFAULT_ABSTAIN_BELOW };
}

/**
 * Damp an answer toward uncertainty by `ood` (through the `dampStrength`
 * ramp): confidence is scaled down, choice/score probabilities are mixed toward
 * uniform, and an unsupported noul "yes" is pulled toward 0.5. The argmax never flips (mixing with uniform preserves
 * order), so an in-scope answer (ood ~ 0) is untouched.
 */
export function dampStrength(ood: number): number {
  return clamp01((ood - DAMP_START) / DAMP_SPAN);
}

export function dampAnswer(a: Answer, ood: number): Answer {
  const k = dampStrength(ood);
  if (k <= 0) return a;
  if (a.type === "noul") {
    // Asymmetric on purpose: for a yes/no question, a state that shares
    // nothing with the question IS evidence for "no" (an off-topic message is
    // correctly "not a refund request"). Only an unsupported "yes" is damped.
    if (a.noul <= 0.5) return a;
    return { ...a, noul: round4(0.5 + (a.noul - 0.5) * (1 - k)) };
  }
  const keys = Object.keys(a.probabilities);
  const u = 1 / Math.max(1, keys.length);
  const probabilities: Record<string, number> = {};
  for (const key of keys) {
    probabilities[key] = round4((a.probabilities[key] ?? 0) * (1 - k) + u * k);
  }
  const confidence = round4(a.confidence * (1 - k));
  if (a.type === "choice") return { ...a, probabilities, confidence };
  let expected = 0;
  for (const key of keys) expected += Number(key) * (probabilities[key] ?? 0);
  return { ...(a as ScoreAnswer), probabilities, confidence, score: round4(expected) };
}

/**
 * Convert an answer into an abstention: attach `abstained` + reason + the
 * probability mass on "none of the above". For choice the reserved
 * `__none__` option becomes the choice (its probability is added, the real
 * options are rescaled so the distribution still sums to 1). Score and noul
 * keep their numeric value for logging but callers MUST branch on `abstained`.
 */
export function abstainAnswer(a: Answer, reason: AbstainReason, pNone: number): Answer {
  const p = round4(clamp01(pNone));
  if (a.type === "choice") {
    const probabilities: Record<string, number> = {};
    for (const [k, v] of Object.entries(a.probabilities)) {
      if (k === NONE_OPTION) continue;
      probabilities[k] = round4(v * (1 - p));
    }
    probabilities[NONE_OPTION] = p;
    const c: ChoiceAnswer = {
      ...a,
      choice: NONE_OPTION,
      probabilities,
      abstained: true,
      abstain_reason: reason,
      p_none: p,
    };
    return c;
  }
  return { ...a, abstained: true, abstain_reason: reason, p_none: p };
}

/** Text used for distance scoring: the whole state flattened to prose. */
export function scopeStateText(state: State): string {
  return stateProse(state);
}

/**
 * `OTS_SCOPE_DAMPING=off` disables damping (scores are still attached). Used
 * only for the leaderboard's ablation row, so the effect of the scope layer is
 * measured instead of asserted. Never set it in production.
 */
function dampingDisabled(): boolean {
  return typeof process !== "undefined" && process.env?.OTS_SCOPE_DAMPING === "off";
}

export type ScopeOptions = {
  /** Damp confidences by `ood` (true for non-LLM backends). */
  damp: boolean;
  /**
   * Backend-supplied out-of-scope scores per question id (the embedding
   * engine's fitted detector). When present they replace the lexical
   * distance signal for those questions.
   */
  ood?: Readonly<Record<string, number>>;
};

/**
 * Attach `ood` to every answer, damp off-topic answers, and apply opt-in
 * abstention. Returns new answers; never mutates the input.
 */
export function applyScope(
  req: SystemOneRequest,
  answers: Record<string, Answer>,
  opts: ScopeOptions,
): Record<string, Answer> {
  const stateText = scopeStateText(req.state);
  // The request's questions together define the application's domain. A state
  // that is on-topic for the domain is in scope even for a question that does
  // not apply to it (that question answers "not applicable" with low
  // confidence on its own); OOD means outside the whole domain.
  const domainText = Object.values(req.questions).map(questionText).join(" \n ");
  const domainRel = relevanceToText(stateText, domainText);
  const out: Record<string, Answer> = {};
  for (const [id, raw] of Object.entries(answers)) {
    const q = req.questions[id];
    if (!q) {
      out[id] = raw;
      continue;
    }
    const override = opts.ood?.[id];
    const sig =
      typeof override === "number"
        ? { ood: round4(clamp01(override)) }
        : scopeSignal(stateText, q, raw, domainRel);
    let a: Answer = opts.damp && !dampingDisabled() ? dampAnswer(raw, sig.ood) : raw;
    a = { ...a, ood: sig.ood };
    const policy = abstainPolicy(req, q);
    if (policy.enabled) {
      const conf = answerConfidence(a);
      if (sig.ood >= OOD_THRESHOLD) {
        a = abstainAnswer(a, "out_of_scope", Math.max(sig.ood, 1 - conf));
      } else if (conf < policy.below) {
        a = abstainAnswer(a, "low_confidence", 1 - conf);
      }
    }
    out[id] = a;
  }
  return out;
}
