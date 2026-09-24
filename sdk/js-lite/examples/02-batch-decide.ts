/**
 * Batch call + decideWithSpec.
 *
 * Shows how to ask multiple questions about the same piece of state in ONE API
 * call using `client.batch()` (alias for `systemOne`), then resolve all answers
 * in one `decideWithSpec()` call. This pattern is the most efficient way to
 * extract multiple signals from a single item.
 *
 * Use this when you need several judgments about one object: categorize AND score
 * AND flag — without paying for three separate round-trips.
 *
 * Run: tsx examples/02-batch-decide.ts
 * Requires: TYPESAFE_API_KEY in env.
 */

import { TypeSafeClient, noul, choice, score } from '../src/index.ts';
import { decideWithSpec } from '../src/schema.ts';
import type { DecisionSpec } from '../src/schema.ts';

const client = new TypeSafeClient();

// ---- The item we want to judge in one round-trip --------------------------

const productReview = {
  product: 'Wireless noise-cancelling headphones',
  rating: 2,
  title: 'Broke after 3 weeks',
  body: `
    Sound quality was amazing for the first few weeks. Then one earcup stopped
    working completely. Customer service said it's out of warranty even though
    I bought these 23 days ago. Very disappointed. Returning immediately.
  `,
};

// ---- Define the output shape and spec -------------------------------------
//
// DecisionSpec co-locates each question definition with its decision parameters.
// Call buildQuestions(spec) to get the question map for systemOne;
// call decideWithSpec(answers, spec) to get the typed output.

type ReviewAnalysis = {
  sentiment: 'positive' | 'neutral' | 'negative';
  hasProductDefect: boolean;
  priorityForResponse: 'low' | 'medium' | 'high';
  qualityScore: number; // 0..3 — how detailed/useful is this review?
};

const spec: DecisionSpec<ReviewAnalysis> = {
  sentiment: {
    def: choice(
      'What is the overall sentiment of this product review?',
      {
        positive: 'Satisfied or enthusiastic about the product.',
        neutral: 'Mixed or factual with no strong emotional valence.',
        negative: 'Disappointed, frustrated, or explicitly dissatisfied.',
      },
    ),
    type: 'choice',
    minConfidence: 0.7,
    map: (v) => v as ReviewAnalysis['sentiment'],
    fallback: 'neutral',
  },

  hasProductDefect: {
    def: noul(
      'Does this review describe a hardware defect, malfunction, or premature failure of the product?',
      {
        true: 'Review describes a specific physical failure or defect',
        false: 'No product defect described; may be a usage issue or opinion',
      },
    ),
    type: 'noul',
    yes: 0.75,
    map: (v) => v === 'yes',
    fallback: false,
  },

  priorityForResponse: {
    def: choice(
      'How urgently should the brand respond to this review?',
      {
        low: 'Positive or routine feedback; a response is nice but not urgent.',
        medium: 'Constructive criticism; warrants a helpful reply within a few days.',
        high: 'Angry customer, defect report, or potential churn; respond today.',
      },
    ),
    type: 'choice',
    minConfidence: 0.65,
    map: (v) => v as ReviewAnalysis['priorityForResponse'],
    fallback: 'medium',
  },

  qualityScore: {
    def: score(
      'How detailed, specific, and useful is this review for other potential buyers?',
      [
        'Unhelpful: vague, one-word, or not actionable.',
        'Basic: some detail but limited specifics.',
        'Good: describes specific features, use case, and outcomes.',
        'Excellent: comprehensive, balanced, with specific examples.',
      ],
    ),
    type: 'score',
    atOrAbove: 2,
    map: (v) => (v === 'above' ? 3 : 1) as ReviewAnalysis['qualityScore'],
    fallback: 1,
  },
};

// ---- One API call, all questions in parallel on the server ----------------

import { buildQuestions } from '../src/schema.ts';

const questions = buildQuestions(spec);
const result = await client.batch(productReview, questions);

console.log('Request ID:', result.requestId);
console.log('Raw answers:', JSON.stringify(result.answers, null, 2));
console.log();

// ---- Resolve all fields in code (no re-inference needed) ------------------

const decision = decideWithSpec(result.answers, spec);

console.log('Resolved output:');
console.log('  sentiment:          ', decision.value.sentiment);
console.log('  hasProductDefect:   ', decision.value.hasProductDefect);
console.log('  priorityForResponse:', decision.value.priorityForResponse);
console.log('  allDecided:         ', decision.allDecided);

if (!decision.allDecided) {
  console.log('  escalations:        ', decision.escalations);
}

console.log();
console.log('Per-field verdicts:');
for (const [field, verdict] of Object.entries(decision.verdicts)) {
  console.log(`  ${field}: outcome=${verdict.outcome} strength=${verdict.strength.toFixed(3)}`);
}
