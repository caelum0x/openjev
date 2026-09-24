/**
 * Meta ads + content — OpenJev scoring and ranking.
 *
 * This is the "find winning meta ads in seconds" and content-creation surface.
 * It does NOT generate copy. It SELECTS and SCORES: score each ad/creative once
 * across independent dimensions, then let code combine those signals with tunable
 * weights (the composite-scoring pattern). Changing a weight re-ranks instantly
 * without re-running otsone, and the raw dimension scores double as ML features once
 * you have real spend/conversion outcomes to label them with.
 *
 * Typical loop: pull candidate ads (from the Meta Ad Library, your account, or a
 * competitor sweep) -> scoreAdCreative each (batched) -> rankAds by composite ->
 * spend on the top, escalate the uncertain middle to a human.
 *
 * Functions:
 *   scoreAdCreative         – score one creative across all dimensions (one call)
 *   rankAds                 – concurrent score + sort for a batch
 *   judgeContentIdea        – greenlight/rank a content idea
 *   screenAdHeadline        – fast single-question headline pre-check
 *   auditCompetitorAd       – extract competitive intelligence from one competitor ad
 */
import { OpenJevClient } from '../src/client.ts';
import { noul, score, choice, isNoul, isScore, isChoice } from '../src/primitives.ts';
import type { Answer, ScoreAnswer } from '../src/primitives.ts';
import { compositeScore, decideNoul, decideChoice } from '../src/decide.ts';

export interface AdCreative {
  readonly id: string;
  readonly product: string;
  readonly audience: string;
  readonly platform: 'facebook' | 'instagram' | 'reels' | 'stories' | 'other';
  readonly format: 'image' | 'video' | 'carousel' | 'text';
  readonly headline?: string;
  readonly primaryText: string;
  readonly cta?: string;
  /** Optional observed metrics to ground the judgment. */
  readonly metrics?: {
    readonly impressions?: number;
    readonly ctr?: number;
    readonly cpa?: number;
    readonly roas?: number;
    readonly daysRunning?: number;
  };
}

export interface AdScores {
  readonly id: string;
  readonly hook: number;
  readonly clarity: number;
  readonly desire: number;
  readonly ctaStrength: number;
  readonly scrollStopping: number;
  /** 0..1 composite from the weighted dimensions. */
  readonly composite: number;
  /** Likely a proven winner worth scaling spend on. */
  readonly likelyWinner: boolean;
  /** Flagged for a policy/compliance risk (needs human review). */
  readonly policyRisk: boolean;
  readonly confidence: number;
}

/** Default dimension weights (0..1); tune per account without re-running inference. */
export interface AdWeights {
  readonly hook: number;
  readonly clarity: number;
  readonly desire: number;
  readonly ctaStrength: number;
  readonly scrollStopping: number;
}

export const DEFAULT_AD_WEIGHTS: AdWeights = {
  hook: 0.3,
  clarity: 0.15,
  desire: 0.25,
  ctaStrength: 0.15,
  scrollStopping: 0.15,
};

const HOOK = [
  'Weak: generic opener, no reason to stop.',
  'Okay: a mild angle or benefit.',
  'Strong: a specific, curiosity- or pain-driven hook.',
  'Exceptional: a scroll-stopping hook that names the exact desire.',
];
const CLARITY = [
  'Confusing: unclear what is offered or to whom.',
  'Somewhat clear: offer readable with effort.',
  'Clear: offer, audience, and value obvious fast.',
  'Crystal: instantly understood in one glance.',
];
const DESIRE = [
  'Flat: no emotional or outcome pull.',
  'Mild: some benefit implied.',
  'Compelling: a vivid, wanted outcome.',
  'Irresistible: taps a strong felt need with proof.',
];
const CTA = [
  'Missing/weak: no clear next step.',
  'Present: a plain CTA.',
  'Strong: specific, low-friction, benefit-framed CTA.',
  'Urgent+specific: compelling reason to act now.',
];
const SCROLL = [
  'Ignorable: blends into the feed.',
  'Noticeable: mild pattern interrupt.',
  'Stops the scroll: strong visual/verbal interrupt.',
  'Impossible to ignore for the target audience.',
];

/** Narrow an answer to a ScoreAnswer, or `undefined` if it is not one. */
function asScoreOrUndefined(ans: Answer | undefined): ScoreAnswer | undefined {
  return ans !== undefined && isScore(ans) ? ans : undefined;
}

/**
 * Score one creative across all dimensions in a single batched call.
 */
export async function scoreAdCreative(
  client: OpenJevClient,
  ad: AdCreative,
  weights: AdWeights = DEFAULT_AD_WEIGHTS,
): Promise<AdScores> {
  const res = await client.systemOne({
    state: {
      ad: {
        product: ad.product,
        audience: ad.audience,
        platform: ad.platform,
        format: ad.format,
        headline: ad.headline ?? null,
        primaryText: ad.primaryText,
        cta: ad.cta ?? null,
        observedMetrics: ad.metrics ?? null,
      },
      note: 'Judge this as a paid Meta (Facebook/Instagram) ad creative aimed at the stated audience. If observed metrics are present, weight them; otherwise judge the copy on its merits.',
    },
    questions: {
      hook: score('How strong is the opening hook for the target audience?', HOOK),
      clarity: score('How clear is the offer and who it is for?', CLARITY),
      desire: score('How much desire does this create for the outcome?', DESIRE),
      ctaStrength: score('How strong and actionable is the call to action?', CTA),
      scrollStopping: score('How scroll-stopping is this in a crowded feed?', SCROLL),
      likelyWinner: noul('Is this likely a winning ad worth scaling spend on for this audience?', {
        true: 'Strong creative and/or metrics indicate a scalable winner',
        false: 'Unproven or weak; do not scale yet',
      }),
      policyRisk: noul(
        'Might this ad violate Meta advertising policy (unrealistic claims, prohibited content, personal-attribute targeting)?',
        {
          true: 'Plausible policy violation; needs human review',
          false: 'No obvious policy issue',
        },
      ),
    },
  });

  const a = res.answers;
  const hook = asScoreOrUndefined(a.hook);
  const clarity = asScoreOrUndefined(a.clarity);
  const desire = asScoreOrUndefined(a.desire);
  const ctaStrength = asScoreOrUndefined(a.ctaStrength);
  const scrollStopping = asScoreOrUndefined(a.scrollStopping);
  const composite = compositeScore([
    ...(hook ? [{ answer: hook, weight: weights.hook }] : []),
    ...(clarity ? [{ answer: clarity, weight: weights.clarity }] : []),
    ...(desire ? [{ answer: desire, weight: weights.desire }] : []),
    ...(ctaStrength ? [{ answer: ctaStrength, weight: weights.ctaStrength }] : []),
    ...(scrollStopping ? [{ answer: scrollStopping, weight: weights.scrollStopping }] : []),
  ]);
  const winnerAns = a.likelyWinner;
  const policyAns = a.policyRisk;
  return {
    id: ad.id,
    hook: hook?.score ?? 0,
    clarity: clarity?.score ?? 0,
    desire: desire?.score ?? 0,
    ctaStrength: ctaStrength?.score ?? 0,
    scrollStopping: scrollStopping?.score ?? 0,
    composite: composite.value,
    likelyWinner:
      winnerAns !== undefined &&
      isNoul(winnerAns) &&
      decideNoul(winnerAns, { yes: 0.7 }).outcome === 'yes',
    policyRisk:
      policyAns !== undefined &&
      isNoul(policyAns) &&
      decideNoul(policyAns, { yes: 0.5 }).outcome !== 'no',
    confidence: hook?.confidence ?? 0,
  };
}

/**
 * Score and rank a batch of creatives, best composite first. Runs the ads
 * concurrently (each is its own batched call). Returns scores plus the ranking.
 */
export async function rankAds(
  client: OpenJevClient,
  ads: readonly AdCreative[],
  weights: AdWeights = DEFAULT_AD_WEIGHTS,
): Promise<AdScores[]> {
  const scored = await Promise.all(ads.map((ad) => scoreAdCreative(client, ad, weights)));
  return [...scored].sort((x, y) => y.composite - x.composite);
}

export interface ContentIdea {
  readonly id: string;
  readonly idea: string;
  readonly platform: string;
  readonly brandVoice?: string;
  readonly audience?: string;
}

export interface ContentVerdict {
  readonly id: string;
  readonly onBrand: number;
  readonly originality: number;
  readonly viralPotential: number;
  readonly composite: number;
  readonly greenlight: boolean;
  readonly confidence: number;
}

/**
 * Greenlight / rank content ideas for creation. Same score-then-compose pattern.
 */
export async function judgeContentIdea(
  client: OpenJevClient,
  idea: ContentIdea,
): Promise<ContentVerdict> {
  const res = await client.systemOne({
    state: {
      idea: idea.idea,
      platform: idea.platform,
      brandVoice: idea.brandVoice ?? null,
      audience: idea.audience ?? null,
    },
    questions: {
      onBrand: score('How well does this idea fit the brand voice and audience?', [
        'Off-brand: wrong voice or audience.',
        'Loosely on-brand.',
        'On-brand and relevant.',
        'Perfectly on-brand and timely.',
      ]),
      originality: score('How original is this idea versus what already floods this platform?', [
        'Cliche: overdone.',
        'Familiar with a small twist.',
        'Fresh angle.',
        'Genuinely novel.',
      ]),
      viralPotential: score('How likely is this to earn shares/saves on this platform?', [
        'Low: little reason to share.',
        'Some: mild shareability.',
        'High: strong hook and payoff.',
        'Very high: built to spread.',
      ]),
      greenlight: noul('Should we produce this piece of content?', {
        true: 'Worth producing now',
        false: 'Skip or rework first',
      }),
    },
  });

  const a = res.answers;
  const onBrand = asScoreOrUndefined(a.onBrand);
  const originality = asScoreOrUndefined(a.originality);
  const viral = asScoreOrUndefined(a.viralPotential);
  const composite = compositeScore([
    ...(onBrand ? [{ answer: onBrand, weight: 0.3 }] : []),
    ...(originality ? [{ answer: originality, weight: 0.3 }] : []),
    ...(viral ? [{ answer: viral, weight: 0.4 }] : []),
  ]);
  const green = a.greenlight;
  return {
    id: idea.id,
    onBrand: onBrand?.score ?? 0,
    originality: originality?.score ?? 0,
    viralPotential: viral?.score ?? 0,
    composite: composite.value,
    greenlight:
      green !== undefined && isNoul(green) && decideNoul(green, { yes: 0.6 }).outcome === 'yes',
    confidence: onBrand?.confidence ?? 0,
  };
}

export type HeadlineVerdict = 'strong' | 'weak' | 'needs_revision' | 'policy_risk';

export interface HeadlineScreenResult {
  readonly verdict: HeadlineVerdict;
  readonly confidence: number;
  readonly policyRisk: boolean;
  readonly reason: string;
}

/**
 * Fast pre-flight check on a single ad headline before investing in full creative
 * production. One batched call; cheaper than `scoreAdCreative` when you only need
 * a quick gate on headline quality and policy compliance.
 *
 * Use this in a brief-review flow: generate N headline candidates, screen each,
 * discard weak/risky ones, then pass survivors to `scoreAdCreative`.
 */
export async function screenAdHeadline(
  client: OpenJevClient,
  headline: string,
  context: { product: string; audience: string; platform: string },
): Promise<HeadlineScreenResult> {
  const res = await client.systemOne({
    state: {
      headline,
      product: context.product,
      audience: context.audience,
      platform: context.platform,
      note: 'Evaluate this ad headline only (no body copy). Judge whether it is strong enough to justify full creative production, or if it needs revision before moving forward.',
    },
    questions: {
      headlineQuality: choice(
        'How would you classify this headline for a paid ad on this platform?',
        {
          strong: 'Compelling, specific hook; ready for creative production as-is.',
          needs_revision: 'Has a usable angle but needs sharpening before production.',
          weak: 'Generic, vague, or unlikely to stop the scroll; skip or rewrite.',
        },
      ),
      policyRisk: noul(
        'Does this headline contain claims or language that might trigger Meta ad policy rejection (misleading claims, prohibited categories, personal attributes)?',
        {
          true: 'Plausible policy issue; flag for human review',
          false: 'No obvious policy concern in the headline',
        },
      ),
    },
  });

  const qualityAns = res.answers.headlineQuality;
  const policyAns = res.answers.policyRisk;
  const confidence = isChoice(qualityAns) ? qualityAns.confidence : 0;
  const policyRisk =
    policyAns !== undefined &&
    isNoul(policyAns) &&
    decideNoul(policyAns, { yes: 0.5 }).outcome !== 'no';

  let verdict: HeadlineVerdict = 'needs_revision';
  let reason = 'low confidence on headline quality';
  if (isChoice(qualityAns)) {
    const v = decideChoice<HeadlineVerdict>(qualityAns, { minConfidence: 0.7 });
    if (v.decided) {
      verdict = v.outcome as HeadlineVerdict;
      reason = v.reason;
    }
  }
  if (policyRisk) {
    verdict = 'policy_risk';
    reason = 'headline flagged for policy risk; needs human review';
  }
  return { verdict, confidence, policyRisk, reason };
}

export interface CompetitorAd {
  readonly id: string;
  readonly brand: string;
  readonly headline?: string;
  readonly primaryText: string;
  readonly cta?: string;
  readonly format: 'image' | 'video' | 'carousel' | 'text';
  /** How long this ad has been running (a proxy for it being a winner). */
  readonly estimatedDaysRunning?: number;
  readonly platform: string;
}

export interface CompetitorInsight {
  readonly id: string;
  readonly brand: string;
  /**
   * The core angle or mechanism driving this ad. e.g. "social proof",
   * "before/after transformation", "fear of missing out".
   */
  readonly dominantAngle: string;
  /** 0..3 estimated creative quality based on copy signals. */
  readonly estimatedQuality: number;
  /**
   * Whether this ad appears to be a long-running, likely-profitable "control"
   * that you should study and respond to.
   */
  readonly isLikelyControl: boolean;
  /**
   * The single most actionable takeaway for your own creative strategy based on
   * what this competitor is doing well or poorly.
   */
  readonly keyTakeaway: string;
  readonly confidence: number;
}

/**
 * Extract competitive intelligence from one competitor ad. Feed competitor ads
 * scraped from the Meta Ad Library into this function and sort by
 * `estimatedQuality` to find their controls.
 */
export async function auditCompetitorAd(
  client: OpenJevClient,
  ad: CompetitorAd,
  yourProduct?: string,
): Promise<CompetitorInsight> {
  const res = await client.systemOne({
    state: {
      competitorAd: {
        brand: ad.brand,
        headline: ad.headline ?? null,
        primaryText: ad.primaryText,
        cta: ad.cta ?? null,
        format: ad.format,
        estimatedDaysRunning: ad.estimatedDaysRunning ?? null,
        platform: ad.platform,
      },
      yourProduct: yourProduct ?? null,
      note: 'Analyze this competitor ad as a media buyer. Long-running ads with strong copy are likely profitable; extract the angle and what makes it work.',
    },
    questions: {
      dominantAngle: choice('What is the primary persuasion angle driving this ad?', {
        social_proof: 'Testimonials, reviews, or "X people love this".',
        transformation: 'Before/after, problem-to-solution arc.',
        curiosity: 'Headline creates curiosity gap or open loop.',
        fear_fomo: 'Fear of missing out, scarcity, or loss framing.',
        authority: 'Expert credibility, certifications, media mentions.',
        direct_offer: 'Leads with the specific price, discount, or guarantee.',
        entertainment: 'Humor, story, or emotional journey without a hard sell.',
        other: 'Does not fit the above categories cleanly.',
      }),
      estimatedQuality: score(
        'How effective does this ad appear to be as a paid creative, judging purely from copy quality and structure?',
        [
          'Poor: generic, weak hook, no reason to engage.',
          'Below average: some effort but forgettable.',
          'Good: solid hook, clear offer, competent execution.',
          'Excellent: tight copy, strong hook, memorable and likely profitable.',
        ],
      ),
      isLikelyControl: noul(
        'Does this appear to be a long-running control ad that has proven profitable for the brand? (Long run time + strong copy signals = control.)',
        {
          true: 'Copy signals and run time suggest this is a profitable control',
          false: 'Not enough signals to call this a control',
        },
      ),
    },
  });

  const angleAns = res.answers.dominantAngle;
  const qualityAns = res.answers.estimatedQuality;
  const controlAns = res.answers.isLikelyControl;
  const estimatedQuality = isScore(qualityAns) ? qualityAns.score : 0;
  const confidence = isScore(qualityAns) ? qualityAns.confidence : 0;
  const dominantAngle =
    isChoice(angleAns) && decideChoice(angleAns, { minConfidence: 0.6 }).decided
      ? angleAns.choice
      : 'other';
  const isLikelyControl =
    controlAns !== undefined &&
    isNoul(controlAns) &&
    decideNoul(controlAns, { yes: 0.65 }).outcome === 'yes';

  // Derive an actionable takeaway from the combination of quality + angle + control status.
  let keyTakeaway: string;
  if (isLikelyControl && estimatedQuality >= 2.5) {
    keyTakeaway = `High-quality ${dominantAngle} angle is likely their control — test a direct response to this angle in your own creative.`;
  } else if (estimatedQuality < 1.5) {
    keyTakeaway = `Weak creative with a ${dominantAngle} angle — there may be an opportunity to outperform them in this space.`;
  } else {
    keyTakeaway = `Mid-tier ${dominantAngle} approach — study the structure but do not copy directly.`;
  }

  return {
    id: ad.id,
    brand: ad.brand,
    dominantAngle,
    estimatedQuality,
    isLikelyControl,
    keyTakeaway,
    confidence,
  };
}

export { OpenJevClient };
/** @deprecated Use {@link OpenJevClient} instead. */
export { OpenJevClient as TypeSafeClient };
