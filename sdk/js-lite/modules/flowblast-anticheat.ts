/**
 * FlowBlast — OpenJev judgments for the replay-worker and liveops.
 *
 * The deterministic `@flowblast/sim` replay is the source of truth for fairness.
 * It is expensive, so per FLOWBLAST_BACKEND.md §6 the worker only replays when a
 * score is >= p90 or on a random 5%. OpenJev sits IN FRONT of that as cheap
 * triage: it decides which of the ordinary submissions are worth escalating to a
 * full sim replay, and helps liveops decide seed retraction — turning the
 * worker's semantic "is this suspicious / should we act" calls into typed,
 * confidence-thresholded gates instead of guesses or blanket replays.
 *
 * OpenJev NEVER decides a ban or overturns the sim. `escalate` here means
 * "hand to the deterministic verifier / a human", never "punish".
 *
 * Functions:
 *   triageDailyScore      – cheap pre-sim triage for a single Daily submission
 *   judgeSeedRetraction   – should today's seed be retracted and re-minted?
 *   screenRelayPayload    – consistency check on a multiplayer Relay handoff
 *   judgeReplayDispute    – weigh a player's dispute against the sim flag
 *   scanLeaderboardEntry  – quick rank-context anomaly check before posting
 */
import { OpenJevClient } from '../src/client.ts';
import { choice, noul, score, isNoul, isChoice, isScore } from '../src/primitives.ts';
import type { Answer } from '../src/primitives.ts';
import { decideNoul, decideScore, decideChoice } from '../src/decide.ts';

// ---- Shared level scales --------------------------------------------------

const SUSPICION_LEVELS = [
  'Ordinary: score fits the seed and the population; nothing unusual.',
  'Slightly high: plausible for a strong player but above the median.',
  'Improbable: near or above the maximum a fair run of this seed can produce.',
  'Impossible: could not be reached by legal play of this seed.',
];

export interface DailyScoreContext {
  readonly seed: string;
  readonly mode: 'classic' | 'picture';
  readonly score: number;
  /** Percentile of this score in today's distribution (0..100), if known. */
  readonly percentile?: number;
  /** Client-reported brick/board stats, if the trace was sent. */
  readonly hasTrace: boolean;
  readonly deviceAgeDays?: number;
  readonly priorRejectedSubmissions?: number;
  /** Rough population stats for grounding the judgment. */
  readonly medianScoreToday?: number;
  readonly maxPlausibleScore?: number;
}

export interface AntiCheatVerdict {
  /** Accept immediately without a sim replay. */
  readonly accept: boolean;
  /** Escalate to a deterministic `@flowblast/sim` replay before accepting. */
  readonly replayNeeded: boolean;
  /** 0..3 suspicion level from the Score primitive. */
  readonly suspicion: number;
  readonly confidence: number;
  readonly reason: string;
  /**
   * Structured reason code for logging / dashboards. The string form is
   * human-readable; the code is machine-stable across copy changes.
   */
  readonly reasonCode:
    | 'accepted'
    | 'p90_rule'
    | 'prior_rejections'
    | 'impossible_for_seed'
    | 'suspicious_score'
    | 'low_confidence';
}

/**
 * Triage a Daily submission. Batches every question into one call.
 * Policy is applied in code so thresholds can be tuned without re-running otsone.
 */
export async function triageDailyScore(
  client: OpenJevClient,
  ctx: DailyScoreContext,
): Promise<AntiCheatVerdict> {
  const res = await client.systemOne({
    state: {
      submission: {
        seed: ctx.seed,
        mode: ctx.mode,
        score: ctx.score,
        percentileInDistribution: ctx.percentile ?? null,
        clientSentTrace: ctx.hasTrace,
        deviceAgeDays: ctx.deviceAgeDays ?? null,
        priorRejectedSubmissions: ctx.priorRejectedSubmissions ?? 0,
      },
      population: {
        medianScoreToday: ctx.medianScoreToday ?? null,
        maxPlausibleScore: ctx.maxPlausibleScore ?? null,
      },
      note: 'FlowBlast is an 8x8/12x12 line-clear puzzle with a Flow Charge meter. Scores scale with combos and color flows; there is a realistic ceiling per seed.',
    },
    questions: {
      suspicion: score(
        'Rate how suspicious this Daily score is, given the seed, the population median, and the plausible ceiling for fair play.',
        SUSPICION_LEVELS,
      ),
      impossible: noul(
        'Could this exact score be impossible to reach by legal play of this seed (e.g. it exceeds the plausible ceiling)?',
        {
          true: 'Score exceeds what fair play of this seed can produce',
          false: 'Score is within reach of a skilled fair run',
        },
      ),
    },
  });

  const suspicionAns = res.answers.suspicion;
  const impossibleAns = res.answers.impossible;
  const suspicion = isScore(suspicionAns) ? suspicionAns.score : 0;
  const confidence = isScore(suspicionAns) ? suspicionAns.confidence : 0;
  const alreadyAboveP90 = (ctx.percentile ?? 0) >= 90;
  const impossible =
    isNoul(impossibleAns) && decideNoul(impossibleAns, { yes: 0.8 }).outcome === 'yes';
  const hasPriorRejections = (ctx.priorRejectedSubmissions ?? 0) > 0;
  const suspicionVerdict = isScore(suspicionAns)
    ? decideScore(suspicionAns, { atOrAbove: 2, minConfidence: 0.6 })
    : { outcome: 'escalate' as const, decided: false, strength: 0, reason: 'no score answer' };
  const replayNeeded =
    impossible ||
    alreadyAboveP90 ||
    hasPriorRejections ||
    suspicionVerdict.outcome === 'above' ||
    suspicionVerdict.outcome === 'escalate';

  let reasonCode: AntiCheatVerdict['reasonCode'];
  if (!replayNeeded) {
    reasonCode = 'accepted';
  } else if (impossible) {
    reasonCode = 'impossible_for_seed';
  } else if (alreadyAboveP90) {
    reasonCode = 'p90_rule';
  } else if (hasPriorRejections) {
    reasonCode = 'prior_rejections';
  } else if (suspicionVerdict.outcome === 'escalate') {
    reasonCode = 'low_confidence';
  } else {
    reasonCode = 'suspicious_score';
  }

  return {
    accept: !replayNeeded,
    replayNeeded,
    suspicion,
    confidence,
    reasonCode,
    reason: impossible
      ? 'flagged impossible-for-seed'
      : alreadyAboveP90
        ? 'p90 rule mandates replay'
        : suspicionVerdict.reason,
  };
}

export interface SeedHealthContext {
  readonly date: string;
  readonly observedBrickRate: number;
  readonly sampleSize: number;
  readonly hoursSincePublish: number;
  /** The offline fuzz brick-rate at mint time, for comparison. */
  readonly fuzzBrickRate?: number;
}

export interface SeedHealthVerdict {
  readonly retract: boolean;
  readonly severity: number;
  readonly confidence: number;
  readonly reason: string;
}

/**
 * Decide whether today's Daily seed should be retracted. Mirrors the GDD rule
 * (brick-rate > 18% in the first 2h with sample > 200, only before 02:00 UTC)
 * but lets otsone weigh borderline cases and divergence from the fuzz estimate.
 */
export async function judgeSeedRetraction(
  client: OpenJevClient,
  ctx: SeedHealthContext,
): Promise<SeedHealthVerdict> {
  const withinWindow = ctx.hoursSincePublish <= 2;
  const enoughSamples = ctx.sampleSize > 200;
  if (!withinWindow || !enoughSamples) {
    return {
      retract: false,
      severity: 0,
      confidence: 1,
      reason: !withinWindow ? 'outside 2h retract window' : 'sample size <= 200',
    };
  }

  const res = await client.systemOne({
    state: {
      seedDate: ctx.date,
      observedBrickRatePct: Math.round(ctx.observedBrickRate * 1000) / 10,
      mintFuzzBrickRatePct:
        ctx.fuzzBrickRate === undefined ? null : Math.round(ctx.fuzzBrickRate * 1000) / 10,
      sampleSize: ctx.sampleSize,
      hoursSincePublish: ctx.hoursSincePublish,
      policy:
        'GDD: brick-rate above 18% in the first 2 hours makes a seed unfair and it should be retracted and re-minted.',
    },
    questions: {
      severity: score('How badly is this Daily seed failing players right now?', [
        'Healthy: brick-rate is in the intended 8-16% band.',
        'Elevated: above target but under the 18% unfair threshold.',
        'Unfair: at or above ~18% brick-rate for a real sample.',
        'Broken: brick-rate far exceeds 18%; the seed is unplayable for many.',
      ]),
      retract: noul('Given the GDD policy, should this seed be retracted and re-minted now?', {
        true: 'Brick-rate is unfairly high for a sufficient sample within the window',
        false: 'Seed is within acceptable bounds or evidence is too thin',
      }),
    },
  });

  const severityAns = res.answers.severity;
  const retractAns = res.answers.retract;
  const severity = isScore(severityAns) ? severityAns.score : 0;
  const confidence = isScore(severityAns) ? severityAns.confidence : 0;
  const retractVerdict = isNoul(retractAns)
    ? decideNoul(retractAns, { yes: 0.75, no: 0.25 })
    : { outcome: 'escalate' as const, reason: 'no retract answer', decided: false, strength: 0 };
  const retract = retractVerdict.outcome === 'yes' || severity >= 2.6;
  return {
    retract,
    severity,
    confidence,
    reason: retractVerdict.reason,
  };
}

export interface RelayContext {
  readonly boardHash: string;
  readonly claimedScore: number;
  readonly claimedCombo: number;
  readonly dropsSinceLastHash: number;
  readonly cellsSummary: string;
}

/**
 * Cheap consistency check on an inbound Relay payload before the worker spends a
 * full sim re-hash. A non-'yes' verdict means "verify with the sim".
 */
export async function screenRelayPayload(
  client: OpenJevClient,
  ctx: RelayContext,
): Promise<{ looksConsistent: boolean; escalate: boolean; reason: string }> {
  const res = await client.systemOne({
    state: { relay: ctx },
    questions: {
      consistent: noul(
        'Do the claimed score, combo, and drop count look internally consistent with a legal FlowBlast board handoff (no impossible jumps)?',
        {
          true: 'Values are mutually consistent for legal play',
          false: 'Values contradict each other or a legal board',
        },
      ),
    },
  });
  const ans = res.answers.consistent;
  const v = isNoul(ans)
    ? decideNoul(ans, { yes: 0.8, no: 0.2 })
    : { outcome: 'escalate' as const, reason: 'no answer', decided: false, strength: 0 };
  return {
    looksConsistent: v.outcome === 'yes',
    escalate: v.outcome !== 'yes',
    reason: v.reason,
  };
}

export interface ReplayDisputeContext {
  /** The submission that the sim flagged as invalid. */
  readonly submission: DailyScoreContext;
  /**
   * The player's dispute statement in their own words (free-form text, already
   * fetched from the support ticket or in-app feedback form).
   */
  readonly playerStatement: string;
  /** How many successful un-disputed submissions this player has in the past 30d. */
  readonly cleanSubmissionsLast30d: number;
  /** Account age in days. */
  readonly accountAgeDays: number;
  /** True if the original flag was deterministic (sim proved impossible). */
  readonly flagWasDeterministic: boolean;
}

export type DisputeOutcome = 'uphold_flag' | 'overturn_flag' | 'human_review';

export interface DisputeVerdict {
  readonly outcome: DisputeOutcome;
  readonly confidence: number;
  /**
   * Whether the player statement itself raises new red flags (e.g. describes
   * knowledge of exploits or manipulated data).
   */
  readonly statementSuspicious: boolean;
  readonly reason: string;
}

/**
 * Weigh a player's appeal against the anti-cheat flag. OpenJev judges the
 * credibility of the player statement and the account's trustworthiness together.
 *
 * Rule: a deterministic sim impossibility can NEVER be overturned here; this
 * function returns 'human_review' at best when the flag was deterministic.
 */
export async function judgeReplayDispute(
  client: OpenJevClient,
  ctx: ReplayDisputeContext,
): Promise<DisputeVerdict> {
  const res = await client.systemOne({
    state: {
      flaggedSubmission: {
        seed: ctx.submission.seed,
        mode: ctx.submission.mode,
        score: ctx.submission.score,
        percentile: ctx.submission.percentile ?? null,
        priorRejectedSubmissions: ctx.submission.priorRejectedSubmissions ?? 0,
      },
      player: {
        cleanSubmissionsLast30d: ctx.cleanSubmissionsLast30d,
        accountAgeDays: ctx.accountAgeDays,
        flagWasDeterministic: ctx.flagWasDeterministic,
      },
      playerStatement: ctx.playerStatement,
      note: 'FlowBlast anti-cheat flagged this submission. The player is disputing the flag. Weigh the plausibility of the player statement and the account history.',
    },
    questions: {
      statementCredibility: score(
        "How credible and internally consistent is the player's dispute statement?",
        [
          'Not credible: contradicts the submission data or describes impossible play.',
          'Weak: vague or generic; adds no new information.',
          'Plausible: consistent with the submission and normal player behavior.',
          'Credible: specific details consistent with a genuine high-skill run.',
        ],
      ),
      statementSuspicious: noul(
        "Does the player's statement contain any red flags (knowledge of exploits, inconsistencies, or script-like descriptions)?",
        {
          true: 'Statement raises new concerns about cheating',
          false: 'No new red flags in the statement',
        },
      ),
      recommendOverturn: choice(
        'Given the account history, the submission, and the player statement, what is the right outcome?',
        {
          uphold_flag: 'Keep the flag; the submission should remain rejected.',
          overturn_flag: 'The dispute is credible; accept the submission.',
          human_review: 'Too uncertain; escalate to a human support agent.',
        },
      ),
    },
  });

  const credAns = res.answers.statementCredibility;
  const suspAns = res.answers.statementSuspicious;
  const outcomeAns = res.answers.recommendOverturn;
  const credibility = isScore(credAns) ? credAns.score : 0;
  const confidence = isScore(credAns) ? credAns.confidence : 0;
  const statementSuspicious =
    isNoul(suspAns) && decideNoul(suspAns, { yes: 0.65 }).outcome === 'yes';

  // Deterministic safety rail: a sim-proven impossibility cannot be overturned here.
  if (ctx.flagWasDeterministic) {
    return {
      outcome: statementSuspicious || credibility < 1.5 ? 'uphold_flag' : 'human_review',
      confidence,
      statementSuspicious,
      reason: 'deterministic sim flag; overturn not available via triage',
    };
  }

  let outcome: DisputeOutcome = 'human_review';
  let reason = 'low confidence — routed to human review';
  if (isChoice(outcomeAns)) {
    const v = decideChoice<DisputeOutcome>(outcomeAns, { minConfidence: 0.72 });
    if (v.decided) {
      outcome = v.outcome as DisputeOutcome;
      reason = v.reason;
    }
  }
  // Hard override: suspicious statement always upholds or escalates.
  if (statementSuspicious && outcome === 'overturn_flag') {
    outcome = 'human_review';
    reason = 'statement raised new concerns; escalated despite overturn signal';
  }
  return { outcome, confidence, statementSuspicious, reason };
}

export interface LeaderboardEntryContext {
  readonly playerId: string;
  readonly rank: number;
  readonly totalEntries: number;
  readonly score: number;
  /** Score at the rank immediately above this player, for gap analysis. */
  readonly scoreOneRankAbove?: number;
  readonly scoreOneRankBelow?: number;
  readonly seed: string;
  readonly mode: 'classic' | 'picture';
  /** The population's 99th-percentile score for this seed, if available. */
  readonly p99Score?: number;
}

export interface LeaderboardScanVerdict {
  /** True when this entry is anomalous enough to queue for sim replay. */
  readonly flagForReplay: boolean;
  /** 0..3 gap anomaly: how unusual is the score gap to neighbours? */
  readonly gapAnomaly: number;
  readonly confidence: number;
  readonly reason: string;
}

/**
 * Quick anomaly check for a single leaderboard entry in the context of its
 * neighbours. Designed for batch processing the top-N after each seed window
 * closes. Complements triageDailyScore (which runs at submission time).
 */
export async function scanLeaderboardEntry(
  client: OpenJevClient,
  ctx: LeaderboardEntryContext,
): Promise<LeaderboardScanVerdict> {
  const res = await client.systemOne({
    state: {
      entry: {
        rank: ctx.rank,
        totalEntries: ctx.totalEntries,
        score: ctx.score,
        scoreOneRankAbove: ctx.scoreOneRankAbove ?? null,
        scoreOneRankBelow: ctx.scoreOneRankBelow ?? null,
        p99Score: ctx.p99Score ?? null,
      },
      seed: ctx.seed,
      mode: ctx.mode,
      note: 'Evaluate whether this leaderboard entry is anomalous relative to its rank neighbours and the known population. A legitimate top-1% score should cluster with the scores around it.',
    },
    questions: {
      gapAnomaly: score(
        'How anomalous is the score gap between this entry and its neighbours on the leaderboard?',
        [
          'Normal: gap fits the expected distribution for this rank band.',
          'Slightly large: gap is wider than typical but within plausible skill variance.',
          'Suspicious: gap is large enough to warrant closer inspection.',
          'Extreme: the score is isolated from the rest of the board in a way consistent with manipulation.',
        ],
      ),
      exceedsKnownCeiling: noul(
        'Does this score appear to exceed the known realistic ceiling for fair play of this seed (accounting for the population p99)?',
        {
          true: 'Score exceeds plausible ceiling',
          false: 'Score is within the plausible range for top players',
        },
      ),
    },
  });

  const gapAns = res.answers.gapAnomaly;
  const ceilAns = res.answers.exceedsKnownCeiling;
  const gapAnomaly = isScore(gapAns) ? gapAns.score : 0;
  const confidence = isScore(gapAns) ? gapAns.confidence : 0;
  const exceedsCeiling =
    isNoul(ceilAns) && decideNoul(ceilAns, { yes: 0.75 }).outcome === 'yes';
  const gapVerdict = isScore(gapAns)
    ? decideScore(gapAns, { atOrAbove: 2, minConfidence: 0.6 })
    : { outcome: 'escalate' as const, decided: false, strength: 0, reason: 'no gap answer' };
  const flagForReplay =
    exceedsCeiling || gapVerdict.outcome === 'above' || gapVerdict.outcome === 'escalate';
  return {
    flagForReplay,
    gapAnomaly,
    confidence,
    reason: exceedsCeiling ? 'exceeds known ceiling for seed' : gapVerdict.reason,
  };
}

/** Re-export so worker code needs a single import. */
export { OpenJevClient };
/** @deprecated Use {@link OpenJevClient} instead. */
export { OpenJevClient as TypeSafeClient };
export type { Answer };
