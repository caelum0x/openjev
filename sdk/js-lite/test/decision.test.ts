/**
 * Tests for the enriched decision layer: primitives validation, assertion
 * helpers, confidence/fallback helpers, and the high-level decide() + schema
 * co-location API.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  noul,
  choice,
  score,
  isNoul,
  isChoice,
  isScore,
  asNoul,
  asChoice,
  asScore,
  noulConf,
  isHighConfidence,
  choiceOrElse,
  noulOrElse,
  scoreOrElse,
  PrimitiveError,
  type NoulAnswer,
  type ChoiceAnswer,
  type ScoreAnswer,
} from '../src/primitives.ts';

import {
  decideNoul,
  decideChoice,
  decideScore,
  decide,
  withFallbacks,
  type DecisionSchema,
} from '../src/decide.ts';

import { buildQuestions, validateSpec, decideWithSpec } from '../src/schema.ts';

// ---------------------------------------------------------------------------
// primitives — builder validation
// ---------------------------------------------------------------------------

test('choice() throws PrimitiveError on empty array', () => {
  assert.throws(() => choice('Pick one', []), PrimitiveError);
});

test('choice() throws PrimitiveError on empty object', () => {
  assert.throws(() => choice('Pick one', {}), PrimitiveError);
});

test('choice() throws PrimitiveError on empty key string', () => {
  assert.throws(() => choice('Pick one', ['']), PrimitiveError);
});

test('choice() accepts array of keys and produces null descriptions', () => {
  const q = choice('Pick', ['a', 'b', 'other']);
  assert.equal(q.type, 'choice');
  assert.equal(q.criteria['a'], null);
  assert.equal(q.criteria['other'], null);
});

test('choice() accepts key->description map', () => {
  const q = choice('Pick', { fast: 'Instant', slow: 'Eventually' });
  assert.equal(q.criteria['fast'], 'Instant');
});

test('score() throws PrimitiveError with only one level', () => {
  assert.throws(() => score('Rate', ['only level']), PrimitiveError);
});

test('score() throws PrimitiveError with zero levels', () => {
  assert.throws(() => score('Rate', []), PrimitiveError);
});

test('score() accepts two or more levels', () => {
  const q = score('Rate', ['low', 'medium', 'high']);
  assert.equal(q.type, 'score');
  assert.equal(q.criteria.length, 3);
});

test('noul() is always valid (no structural constraints)', () => {
  const q = noul('Is this spam?');
  assert.equal(q.type, 'noul');
  assert.ok(q.criteria === undefined);
});

test('noul() with criteria round-trips', () => {
  const q = noul('Valid?', { true: 'Meets criteria', false: 'Does not meet' });
  assert.equal(q.criteria!.true, 'Meets criteria');
});

// ---------------------------------------------------------------------------
// primitives — assertion helpers
// ---------------------------------------------------------------------------

const noulAns: NoulAnswer = { type: 'noul', noul: 0.9 };
const choiceAns: ChoiceAnswer = {
  type: 'choice',
  choice: 'good',
  probabilities: { good: 0.9, bad: 0.1 },
  confidence: 0.9,
};
const scoreAns: ScoreAnswer = {
  type: 'score',
  score: 2.5,
  legend: { '0': 'low', '1': 'med', '2': 'high', '3': 'top' },
  probabilities: { '2': 0.7, '3': 0.3 },
  confidence: 0.85,
};

test('isNoul / isChoice / isScore narrow correctly', () => {
  assert.ok(isNoul(noulAns));
  assert.ok(!isNoul(choiceAns));
  assert.ok(isChoice(choiceAns));
  assert.ok(!isChoice(scoreAns));
  assert.ok(isScore(scoreAns));
  assert.ok(!isScore(noulAns));
});

test('asNoul returns the answer when types match', () => {
  assert.equal(asNoul(noulAns), noulAns);
});

test('asNoul throws PrimitiveError on wrong type', () => {
  assert.throws(() => asNoul(choiceAns), PrimitiveError);
});

test('asChoice returns the answer when types match', () => {
  assert.equal(asChoice(choiceAns), choiceAns);
});

test('asChoice throws PrimitiveError on wrong type', () => {
  assert.throws(() => asChoice(noulAns), PrimitiveError);
});

test('asScore returns the answer when types match', () => {
  assert.equal(asScore(scoreAns), scoreAns);
});

test('asScore throws PrimitiveError on wrong type', () => {
  assert.throws(() => asScore(noulAns), PrimitiveError);
});

// ---------------------------------------------------------------------------
// primitives — confidence helpers
// ---------------------------------------------------------------------------

test('noulConf: p=0.5 returns 0 (maximally uncertain)', () => {
  assert.equal(noulConf({ type: 'noul', noul: 0.5 }), 0);
});

test('noulConf: p=1.0 returns 1 (totally certain yes)', () => {
  assert.equal(noulConf({ type: 'noul', noul: 1 }), 1);
});

test('noulConf: p=0.0 returns 1 (totally certain no)', () => {
  assert.equal(noulConf({ type: 'noul', noul: 0 }), 1);
});

test('noulConf: p=0.9 returns 0.8', () => {
  assert.ok(Math.abs(noulConf({ type: 'noul', noul: 0.9 }) - 0.8) < 0.0001);
});

test('isHighConfidence: true above default threshold', () => {
  assert.ok(isHighConfidence(choiceAns)); // confidence=0.9, default=0.85
});

test('isHighConfidence: false below default threshold', () => {
  const low: ChoiceAnswer = { ...choiceAns, confidence: 0.7 };
  assert.ok(!isHighConfidence(low));
});

test('isHighConfidence: custom threshold respected', () => {
  assert.ok(isHighConfidence(choiceAns, 0.95) === false);
  assert.ok(isHighConfidence(choiceAns, 0.85) === true);
});

// ---------------------------------------------------------------------------
// primitives — fallback helpers
// ---------------------------------------------------------------------------

test('choiceOrElse: returns choice when confident', () => {
  assert.equal(choiceOrElse(choiceAns, 0.8, 'unknown'), 'good');
});

test('choiceOrElse: returns fallback when under threshold', () => {
  const low: ChoiceAnswer = { ...choiceAns, confidence: 0.6 };
  assert.equal(choiceOrElse(low, 0.8, 'unknown'), 'unknown');
});

test('noulOrElse: returns yes above yes threshold', () => {
  assert.equal(noulOrElse(noulAns, {}, 'review'), 'yes');
});

test('noulOrElse: returns no below no threshold', () => {
  const no: NoulAnswer = { type: 'noul', noul: 0.05 };
  assert.equal(noulOrElse(no, {}, 'review'), 'no');
});

test('noulOrElse: returns fallback in the uncertain middle', () => {
  const mid: NoulAnswer = { type: 'noul', noul: 0.5 };
  assert.equal(noulOrElse(mid, {}, 'review'), 'review');
});

test('scoreOrElse: returns above when score >= atOrAbove', () => {
  assert.equal(scoreOrElse(scoreAns, 2.0, 'unknown'), 'above');
});

test('scoreOrElse: returns below when score < atOrAbove', () => {
  assert.equal(scoreOrElse(scoreAns, 3.0, 'unknown'), 'below');
});

test('scoreOrElse: returns fallback when confidence < minConf', () => {
  assert.equal(scoreOrElse(scoreAns, 2.0, 'unknown', 0.99), 'unknown');
});

// ---------------------------------------------------------------------------
// decide() — single-answer helpers (regression)
// ---------------------------------------------------------------------------

test('decideNoul: p=0.9 commits yes with strength=0.9', () => {
  const v = decideNoul(noulAns);
  assert.equal(v.outcome, 'yes');
  assert.equal(v.decided, true);
  assert.equal(v.strength, 0.9);
});

test('decideNoul: p=0.5 escalates', () => {
  const v = decideNoul({ type: 'noul', noul: 0.5 });
  assert.equal(v.outcome, 'escalate');
  assert.equal(v.decided, false);
});

test('decideChoice: high confidence commits', () => {
  const v = decideChoice(choiceAns, { minConfidence: 0.85 });
  assert.equal(v.outcome, 'good');
  assert.equal(v.decided, true);
});

test('decideChoice: low confidence escalates', () => {
  const low: ChoiceAnswer = { ...choiceAns, confidence: 0.5 };
  const v = decideChoice(low, { minConfidence: 0.85 });
  assert.equal(v.outcome, 'escalate');
  assert.equal(v.decided, false);
});

test('decideScore: score >= atOrAbove returns above', () => {
  const v = decideScore(scoreAns, { atOrAbove: 2 });
  assert.equal(v.outcome, 'above');
  assert.equal(v.decided, true);
});

test('decideScore: score < atOrAbove returns below', () => {
  const v = decideScore(scoreAns, { atOrAbove: 3 });
  assert.equal(v.outcome, 'below');
  assert.equal(v.decided, true);
});

// ---------------------------------------------------------------------------
// decide() — high-level composition
// ---------------------------------------------------------------------------

type ModOut = { isSpam: boolean; category: string; urgency: 'high' | 'low' };

const answers = {
  isSpam: noulAns,
  category: choiceAns,
  urgency: scoreAns,
};

const schema: DecisionSchema<ModOut> = {
  isSpam: { type: 'noul', yes: 0.85, map: (v) => v === 'yes' },
  category: { type: 'choice', minConfidence: 0.8 },
  urgency: {
    type: 'score',
    atOrAbove: 2,
    map: (v) => (v === 'above' ? 'high' : 'low'),
  },
};

test('decide(): all fields decided when answers are confident', () => {
  const result = decide(answers, schema);
  assert.ok(result.allDecided);
  assert.deepEqual(result.escalations, []);
  assert.equal(result.value.isSpam, true);
  assert.equal(result.value.category, 'good');
  assert.equal(result.value.urgency, 'high');
});

test('decide(): escalated field without fallback is absent from value', () => {
  const lowConf: ChoiceAnswer = { ...choiceAns, confidence: 0.3 };
  const result = decide({ ...answers, category: lowConf }, schema);
  assert.ok(!result.allDecided);
  assert.ok(result.escalations.includes('category'));
  assert.equal(result.value.category, undefined);
});

test('decide(): escalated field with fallback is resolved and not in escalations', () => {
  const lowConf: ChoiceAnswer = { ...choiceAns, confidence: 0.3 };
  const schemaWithFallback: DecisionSchema<ModOut> = {
    ...schema,
    category: { type: 'choice', minConfidence: 0.8, fallback: 'unknown' },
  };
  const result = decide({ ...answers, category: lowConf }, schemaWithFallback);
  assert.ok(result.allDecided);
  assert.equal(result.value.category, 'unknown');
  assert.deepEqual(result.escalations, []);
});

test('decide(): missing answer escalates with descriptive reason', () => {
  const result = decide({ isSpam: noulAns }, schema);
  assert.ok(result.escalations.includes('category'));
  assert.match(result.verdicts['category']?.reason ?? '', /no answer/);
});

test('decide(): type mismatch escalates', () => {
  // pass a noul answer where a choice is expected
  const result = decide({ ...answers, category: noulAns }, schema);
  assert.ok(result.escalations.includes('category'));
  assert.match(result.verdicts['category']?.reason ?? '', /type mismatch/);
});

test('decide(): custom question key via spec.question', () => {
  type Out2 = { label: string };
  const sch: DecisionSchema<Out2> = {
    label: { type: 'choice', question: 'cat', minConfidence: 0.7 },
  };
  const result = decide({ cat: choiceAns }, sch);
  assert.equal(result.value.label, 'good');
});

// ---------------------------------------------------------------------------
// withFallbacks()
// ---------------------------------------------------------------------------

test('withFallbacks(): fills missing escalated fields', () => {
  const lowConf: ChoiceAnswer = { ...choiceAns, confidence: 0.3 };
  const result = decide({ ...answers, category: lowConf }, schema);
  assert.ok(result.escalations.includes('category'));

  const { filled, stillEscalated } = withFallbacks(result, { category: 'fallback_cat' });
  assert.equal(filled.category, 'fallback_cat');
  assert.deepEqual(stillEscalated, []);
});

test('withFallbacks(): leaves already-decided fields untouched', () => {
  const result = decide(answers, schema);
  // No escalations; withFallbacks should be a no-op.
  const { filled, stillEscalated } = withFallbacks(result, { isSpam: false });
  assert.equal(filled.isSpam, true); // original decided value, not overwritten
  assert.deepEqual(stillEscalated, []);
});

test('withFallbacks(): reports still-escalated when no fallback provided', () => {
  const lowConf: ChoiceAnswer = { ...choiceAns, confidence: 0.3 };
  const result = decide({ ...answers, category: lowConf }, schema);
  const { stillEscalated } = withFallbacks(result, {});
  assert.ok(stillEscalated.includes('category'));
});

// ---------------------------------------------------------------------------
// schema: buildQuestions / validateSpec / decideWithSpec
// ---------------------------------------------------------------------------

test('buildQuestions(): extracts question definitions by output key', () => {
  const spec = {
    spam: {
      def: noul('Is this spam?'),
      type: 'noul' as const,
    },
    tag: {
      def: choice('Tag?', ['promo', 'info']),
      type: 'choice' as const,
      minConfidence: 0.8,
    },
  };
  const questions = buildQuestions(spec);
  assert.equal(questions['spam']?.type, 'noul');
  assert.equal(questions['tag']?.type, 'choice');
});

test('validateSpec(): does not throw on valid spec', () => {
  const spec = {
    a: { def: noul('?'), type: 'noul' as const },
    b: { def: score('Rate', ['low', 'high']), type: 'score' as const, atOrAbove: 1 },
  };
  assert.doesNotThrow(() => validateSpec(spec));
});

test('validateSpec(): throws on score question with one level', () => {
  // Bypass the score() builder by constructing the question directly.
  const badDef = { type: 'score' as const, instructions: 'Rate', criteria: ['only'] };
  const spec = { x: { def: badDef, type: 'score' as const, atOrAbove: 0 } };
  assert.throws(() => validateSpec(spec), /at least 2/);
});

test('validateSpec(): throws on choice question with no options', () => {
  const badDef = { type: 'choice' as const, instructions: 'Pick', criteria: {} };
  const spec = { x: { def: badDef, type: 'choice' as const } };
  assert.throws(() => validateSpec(spec), /no option keys/);
});

test('decideWithSpec(): end-to-end with full spec', () => {
  type Email = { isSpam: boolean; priority: 'high' | 'low' };

  const spec = {
    isSpam: {
      def: noul('Is this email spam?'),
      type: 'noul' as const,
      yes: 0.85,
      map: (v: 'yes' | 'no') => v === 'yes',
    },
    priority: {
      def: score('Priority level?', ['low signal', 'medium signal', 'high signal']),
      type: 'score' as const,
      atOrAbove: 1.5,
      map: (v: 'above' | 'below') => (v === 'above' ? 'high' : 'low') as 'high' | 'low',
    },
  };

  const ans = {
    isSpam: { type: 'noul', noul: 0.95 } as NoulAnswer,
    priority: {
      type: 'score',
      score: 2.0,
      legend: { '0': 'low signal', '1': 'medium signal', '2': 'high signal' },
      probabilities: { '2': 0.8, '1': 0.2 },
      confidence: 0.9,
    } as ScoreAnswer,
  };

  const questions = buildQuestions(spec);
  assert.equal(Object.keys(questions).length, 2);

  const result = decideWithSpec<Email>(ans, spec);
  assert.ok(result.allDecided);
  assert.equal(result.value.isSpam, true);
  assert.equal(result.value.priority, 'high');
});
