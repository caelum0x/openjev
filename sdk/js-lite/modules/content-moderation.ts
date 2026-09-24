/**
 * Content moderation — OpenJev UGC pipeline for text submissions.
 *
 * Keyword lists catch known slurs and spam patterns. A full LLM per post is
 * expensive. OpenJev sits in between: confident decisions flow through
 * automatically; uncertain or borderline cases escalate to a human queue.
 *
 * Design principles:
 * - Confidence thresholds are tuned conservatively. False negatives (letting bad
 *   content through) are worse than false positives (over-flagging) for most
 *   platforms. Adjust the thresholds in `moderateText` to match your tolerance.
 * - The `action` field is the only thing your pipeline should act on. The
 *   individual scores (toxicity, spam, policyViolation) are audit signals.
 * - Always log the `requestId` from the client for post-hoc analysis.
 *
 * Functions:
 *   moderateText      – judge one UGC submission
 *   batchModerate     – concurrent moderation for multiple submissions
 *   buildModerationReport – aggregate stats across a batch result
 */

import { OpenJevClient } from '../src/client.ts';
import { noul, score, choice, isNoul, isScore, isChoice } from '../src/primitives.ts';
import { decideNoul, decideScore, decideChoice, compositeScore } from '../src/decide.ts';

// ---- Types ----------------------------------------------------------------

export interface UGCPayload {
  readonly id: string;
  /** The raw text content submitted by the user. */
  readonly text: string;
  /** Platform surface (informs tone expectations). */
  readonly surface: 'public_post' | 'comment' | 'chat_message' | 'bio' | 'review' | 'other';
  /** Account age in days — new accounts have a lower trust bar. */
  readonly authorAccountAgeDays?: number;
  /**
   * Number of prior moderation actions on this author.
   * Used to calibrate the threshold: repeat offenders face stricter gates.
   */
  readonly authorPriorActions?: number;
  /**
   * The community or topic context, e.g. "gaming", "health", "politics".
   * Some content that is acceptable in general contexts is not in sensitive ones.
   */
  readonly communityContext?: string;
}

/**
 * The pipeline decision for a single UGC submission.
 *
 * `allow`    – publish immediately.
 * `flag`     – publish but queue for delayed human review.
 * `remove`   – take down immediately; optionally notify the author.
 * `escalate` – confidence too low; a human must decide before any action.
 */
export type ModerationAction = 'allow' | 'flag' | 'remove' | 'escalate';

export interface ModerationVerdict {
  readonly id: string;
  readonly action: ModerationAction;
  /**
   * Per-dimension severity scores (0..3). Useful for audit logs and for training
   * a fine-tuned classifier on your own content once you have labeled data.
   */
  readonly toxicity: number;
  readonly spam: number;
  readonly policyViolation: number;
  /**
   * The dominant violation type, when one is clear. `none` when the content is
   * clean. Used for reporting and author notifications.
   */
  readonly violationType:
    | 'hate_speech'
    | 'harassment'
    | 'spam'
    | 'misinformation'
    | 'explicit_content'
    | 'self_harm'
    | 'none'
    | 'other';
  /** Model confidence (from the toxicity dimension). */
  readonly confidence: number;
  readonly reason: string;
}

// ---- Shared level scales --------------------------------------------------

const TOXICITY_LEVELS = [
  'None: civil, constructive, or neutral content.',
  'Mild: slightly rude or edgy but within community norms.',
  'Moderate: clearly disrespectful, derogatory, or harassing toward a person.',
  'Severe: hate speech, explicit threats, self-harm, or illegal content.',
] as const;

const SPAM_LEVELS = [
  'Not spam: genuine, human-written content.',
  'Low: repetitive or slightly off-topic but possibly genuine.',
  'Moderate: clearly promotional, bulk-posted, or SEO-stuffed.',
  'Severe: automated spam, phishing, or coordinated inauthentic behavior.',
] as const;

const POLICY_LEVELS = [
  'No violation: content follows community guidelines.',
  'Minor: borderline or context-dependent; might be fine.',
  'Violation: clearly breaks a specific community guideline.',
  'Severe violation: explicitly prohibited content (e.g. CSAM, doxxing, illegal).',
] as const;

// ---- moderateText ---------------------------------------------------------

/**
 * Moderate one UGC text submission. Batches all judgment dimensions into one
 * API call. Returns a typed ModerationVerdict with an explicit action.
 *
 * Threshold policy (tunable in the calling code via config objects):
 * - toxicity >= 3 (severe)      -> remove immediately
 * - spam >= 3 (severe)          -> remove immediately
 * - policyViolation >= 2        -> remove
 * - any >= 2 with low conf      -> escalate to human
 * - new author + mild flags     -> flag for review
 * - clean                       -> allow
 */
export async function moderateText(
  client: OpenJevClient,
  payload: UGCPayload,
): Promise<ModerationVerdict> {
  const isNewAccount = (payload.authorAccountAgeDays ?? 30) < 7;
  const hasRepeatHistory = (payload.authorPriorActions ?? 0) > 2;

  const res = await client.systemOne({
    state: {
      content: {
        text: payload.text,
        surface: payload.surface,
        authorAccountAgeDays: payload.authorAccountAgeDays ?? null,
        authorPriorModerationActions: payload.authorPriorActions ?? 0,
        communityContext: payload.communityContext ?? 'general',
      },
      note: 'Moderate this user-generated text. Consider the surface and community context. Score each dimension independently on its own criteria.',
    },
    questions: {
      toxicity: score(
        'How toxic, harmful, or abusive is this content toward people?',
        TOXICITY_LEVELS,
      ),
      spam: score(
        'How spammy, inauthentic, or platform-abusive is this content?',
        SPAM_LEVELS,
      ),
      policyViolation: score(
        'How clearly does this content violate platform community guidelines?',
        POLICY_LEVELS,
      ),
      violationType: choice(
        'If there is a violation, what is the primary type?',
        {
          hate_speech: 'Attacks people based on identity (race, gender, religion, etc.).',
          harassment: 'Targeted abuse, threats, or intimidation of a specific person.',
          spam: 'Unsolicited promotion, bulk posting, or bot-like behavior.',
          misinformation: 'Demonstrably false claims that could cause harm.',
          explicit_content: 'Sexual or violent content that violates policies.',
          self_harm: 'Content that promotes or glorifies self-harm or suicide.',
          none: 'The content does not violate any guideline.',
          other: 'A violation that does not fit the above categories.',
        },
      ),
      isSafe: noul(
        'Is this content safe to publish without any moderation action?',
        {
          true: 'Content is clean, civil, and within community norms',
          false: 'Content has issues that should be flagged, reviewed, or removed',
        },
      ),
    },
  });

  const toxAns = res.answers.toxicity;
  const spamAns = res.answers.spam;
  const policyAns = res.answers.policyViolation;
  const typeAns = res.answers.violationType;
  const safeAns = res.answers.isSafe;

  const toxicity = isScore(toxAns) ? toxAns.score : 0;
  const spam = isScore(spamAns) ? spamAns.score : 0;
  const policyViolation = isScore(policyAns) ? policyAns.score : 0;
  const confidence = isScore(toxAns) ? toxAns.confidence : 0;

  const violationType =
    isChoice(typeAns) && decideChoice(typeAns, { minConfidence: 0.6 }).decided
      ? (typeAns.choice as ModerationVerdict['violationType'])
      : 'none';

  // Determine action via hard rules first, then model confidence.
  let action: ModerationAction;
  let reason: string;

  const clearRemove =
    toxicity >= 2.7 ||
    spam >= 2.7 ||
    policyViolation >= 2.5 ||
    violationType === 'self_harm';

  const lowConf = confidence < 0.6;

  const toxVerdict = isScore(toxAns)
    ? decideScore(toxAns, { atOrAbove: 2, minConfidence: 0.55 })
    : null;
  const spamVerdict = isScore(spamAns)
    ? decideScore(spamAns, { atOrAbove: 2, minConfidence: 0.55 })
    : null;
  const policyVerdict = isScore(policyAns)
    ? decideScore(policyAns, { atOrAbove: 2, minConfidence: 0.55 })
    : null;

  const safeVerdict = isNoul(safeAns)
    ? decideNoul(safeAns, { yes: 0.8, no: 0.2 })
    : null;

  if (clearRemove) {
    action = 'remove';
    reason = `dimension scores exceed remove threshold (tox=${toxicity.toFixed(2)}, spam=${spam.toFixed(2)}, policy=${policyViolation.toFixed(2)})`;
  } else if (lowConf && (toxicity > 0.5 || spam > 0.5 || policyViolation > 0.5)) {
    action = 'escalate';
    reason = `borderline content with low confidence (${confidence.toFixed(2)}) — needs human review`;
  } else if (
    toxVerdict?.outcome === 'above' ||
    spamVerdict?.outcome === 'above' ||
    policyVerdict?.outcome === 'above'
  ) {
    // Moderate violation, confident — remove or flag based on newness/history.
    action = hasRepeatHistory ? 'remove' : 'flag';
    reason = `moderate ${violationType} violation; repeat=${hasRepeatHistory}`;
  } else if (isNewAccount && (toxicity > 0.3 || spam > 0.3)) {
    // New account with any flags -> flag for review.
    action = 'flag';
    reason = `new account with low-level flags — flagged for review`;
  } else if (safeVerdict?.outcome === 'yes') {
    action = 'allow';
    reason = safeVerdict.reason;
  } else if (safeVerdict?.outcome === 'no') {
    action = 'flag';
    reason = safeVerdict.reason;
  } else {
    action = 'escalate';
    reason = 'insufficient signal — escalate to human';
  }

  return {
    id: payload.id,
    action,
    toxicity,
    spam,
    policyViolation,
    violationType,
    confidence,
    reason,
  };
}

// ---- batchModerate --------------------------------------------------------

/**
 * Moderate multiple UGC submissions concurrently. Each submission is one API
 * call; they run in parallel up to `concurrency` at a time. Returns results in
 * the same order as the input array.
 */
export async function batchModerate(
  client: OpenJevClient,
  payloads: readonly UGCPayload[],
  concurrency = 20,
): Promise<ModerationVerdict[]> {
  const results: ModerationVerdict[] = new Array(payloads.length);
  for (let i = 0; i < payloads.length; i += concurrency) {
    const chunk = payloads.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map((p) => moderateText(client, p)));
    for (let j = 0; j < chunkResults.length; j++) {
      const r = chunkResults[j];
      if (r !== undefined) results[i + j] = r;
    }
  }
  return results;
}

// ---- buildModerationReport ------------------------------------------------

export interface ModerationReport {
  readonly total: number;
  readonly byAction: Readonly<Record<ModerationAction, number>>;
  readonly byViolationType: Readonly<Record<string, number>>;
  /** Average confidence across all verdicts. */
  readonly avgConfidence: number;
  /**
   * Escalation rate (0..1). A rate above 0.1 suggests the model is under-confident
   * on your content distribution — consider submitting labeled examples for
   * calibration.
   */
  readonly escalationRate: number;
}

/**
 * Aggregate a batch of ModerationVerdict results into a summary report. Useful
 * for dashboards and for monitoring the escalation rate over time.
 */
export function buildModerationReport(verdicts: readonly ModerationVerdict[]): ModerationReport {
  if (verdicts.length === 0) {
    return {
      total: 0,
      byAction: { allow: 0, flag: 0, remove: 0, escalate: 0 },
      byViolationType: {},
      avgConfidence: 0,
      escalationRate: 0,
    };
  }

  const byAction: Record<ModerationAction, number> = {
    allow: 0,
    flag: 0,
    remove: 0,
    escalate: 0,
  };
  const byViolationType: Record<string, number> = {};
  let totalConfidence = 0;

  for (const v of verdicts) {
    byAction[v.action] = (byAction[v.action] ?? 0) + 1;
    byViolationType[v.violationType] = (byViolationType[v.violationType] ?? 0) + 1;
    totalConfidence += v.confidence;
  }

  return {
    total: verdicts.length,
    byAction,
    byViolationType,
    avgConfidence: totalConfidence / verdicts.length,
    escalationRate: (byAction.escalate ?? 0) / verdicts.length,
  };
}

export { OpenJevClient };
/** @deprecated Use {@link OpenJevClient} instead. */
export { OpenJevClient as TypeSafeClient };

// Re-export compositeScore for callers that want to build custom composite
// metrics from the raw dimension scores.
export { compositeScore };
