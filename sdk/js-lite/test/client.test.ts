import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenJevClient, OpenJevError } from '../src/client.ts';
import { choice, noul, score } from '../src/primitives.ts';
import { decideNoul, decideChoice, decideScore, compositeScore } from '../src/decide.ts';
import type { ScoreAnswer } from '../src/primitives.ts';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

const OK_BODY = {
  model: 'jev-latest',
  answers: {
    is_urgent: { type: 'noul', noul: 0.95 },
    dept: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9 }, confidence: 0.88 },
    frustration: {
      type: 'score',
      score: 1.05,
      legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Angry' },
      probabilities: { '1': 0.7 },
      confidence: 0.81,
    },
  },
  usage: { input_tokens: 100, output_tokens: 10 },
};

test('constructor throws without a key', () => {
  const prev = {
    a: process.env.OPENJEV_API_KEY,
    b: process.env.TYPESAFE_API_KEY,
    c: process.env.typesafe_api_key,
  };
  delete process.env.OPENJEV_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.typesafe_api_key;
  assert.throws(() => new OpenJevClient({ fetchImpl: fakeFetch(200, OK_BODY) }), OpenJevError);
  if (prev.a) process.env.OPENJEV_API_KEY = prev.a;
  if (prev.b) process.env.TYPESAFE_API_KEY = prev.b;
  if (prev.c) process.env.typesafe_api_key = prev.c;
});

test('reads lowercase typesafe_api_key fallback', async () => {
  const prev = {
    a: process.env.OPENJEV_API_KEY,
    b: process.env.TYPESAFE_API_KEY,
    c: process.env.typesafe_api_key,
  };
  delete process.env.OPENJEV_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  process.env.typesafe_api_key = 'lower-key';
  const client = new OpenJevClient({ fetchImpl: fakeFetch(200, OK_BODY) });
  const res = await client.systemOne({ state: 'x', questions: { is_urgent: noul('urgent?') } });
  assert.equal(res.model, 'jev-latest');
  if (prev.a) process.env.OPENJEV_API_KEY = prev.a; else delete process.env.OPENJEV_API_KEY;
  if (prev.b) process.env.TYPESAFE_API_KEY = prev.b; else delete process.env.TYPESAFE_API_KEY;
  if (prev.c) process.env.typesafe_api_key = prev.c; else delete process.env.typesafe_api_key;
});

test('systemOne parses a batched response', async () => {
  const client = new OpenJevClient({ apiKey: 'k', fetchImpl: fakeFetch(200, OK_BODY) });
  const res = await client.systemOne({
    state: { document: 'I was charged twice.' },
    questions: {
      is_urgent: noul('Is this urgent?'),
      dept: choice('Which team?', ['billing', 'technical', 'other']),
      frustration: score('How frustrated?', ['Calm', 'Frustrated', 'Angry']),
    },
  });
  assert.equal(res.answers.is_urgent.type, 'noul');
  assert.equal(res.answers.dept.type, 'choice');
  assert.equal(res.answers.frustration.type, 'score');
});

test('retries on 429 then succeeds', async () => {
  let calls = 0;
  const flaky: typeof fetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response('slow down', { status: 429 });
    return new Response(JSON.stringify(OK_BODY), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new OpenJevClient({
    apiKey: 'k',
    fetchImpl: flaky,
    sleepImpl: async () => {},
    jitterImpl: () => 0,
  });
  const res = await client.systemOne({ state: 'x', questions: { is_urgent: noul('urgent?') } });
  assert.equal(calls, 2);
  assert.equal(res.model, 'jev-latest');
});

test('throws on non-retryable 401', async () => {
  const client = new OpenJevClient({ apiKey: 'k', fetchImpl: fakeFetch(401, 'nope') });
  await assert.rejects(
    () => client.systemOne({ state: 'x', questions: { q: noul('?') } }),
    (e: unknown) => e instanceof OpenJevError && e.status === 401,
  );
});

test('decideNoul thresholds and escalation band', () => {
  assert.equal(decideNoul({ type: 'noul', noul: 0.95 }).outcome, 'yes');
  assert.equal(decideNoul({ type: 'noul', noul: 0.02 }).outcome, 'no');
  assert.equal(decideNoul({ type: 'noul', noul: 0.5 }).outcome, 'escalate');
});

test('decideChoice requires confidence', () => {
  const conf: import('../src/primitives').ChoiceAnswer = {
    type: 'choice',
    choice: 'billing',
    probabilities: { billing: 0.9 },
    confidence: 0.9,
  };
  assert.equal(decideChoice(conf).outcome, 'billing');
  assert.equal(decideChoice({ ...conf, confidence: 0.5 }).outcome, 'escalate');
});

test('decideScore threshold', () => {
  const a: ScoreAnswer = {
    type: 'score',
    score: 2.4,
    legend: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' },
    probabilities: {},
    confidence: 0.9,
  };
  assert.equal(decideScore(a, { atOrAbove: 2 }).outcome, 'above');
  assert.equal(decideScore({ ...a, score: 1.2 }, { atOrAbove: 2 }).outcome, 'below');
});

test('compositeScore normalizes and weights', () => {
  const mk = (s: number): ScoreAnswer => ({
    type: 'score',
    score: s,
    legend: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' },
    probabilities: {},
    confidence: 1,
  });
  const c = compositeScore([
    { answer: mk(3), weight: 1 },
    { answer: mk(0), weight: 1 },
  ]);
  assert.ok(Math.abs(c.value - 0.5) < 1e-9);
});
