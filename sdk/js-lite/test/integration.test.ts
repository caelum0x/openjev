/**
 * Integration coverage that spans the client, transport policy, config
 * resolution, and a decision module — all offline via an injected fetch.
 * These complement the unit suites in foundation/decision/client/modules.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OpenJevClient } from '../src/client.ts';
import { noul, choice, score } from '../src/primitives.ts';
import { triageTicket } from '../modules/support-triage.ts';

const OK_BODY = {
  model: 'jev-latest',
  answers: {
    q: { type: 'noul', noul: 0.9 },
  },
  usage: { input_tokens: 5, output_tokens: 1 },
};

/** A fetch stub that returns a fixed JSON body/status on every call. */
function fixedFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Transport: Retry-After is honored ahead of jittered backoff
// ---------------------------------------------------------------------------

test('client honors a Retry-After header on 429 before retrying', async () => {
  let calls = 0;
  const flaky: typeof fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '2' },
      });
    }
    return new Response(JSON.stringify(OK_BODY), { status: 200 });
  }) as unknown as typeof fetch;

  const sleeps: number[] = [];
  const client = new OpenJevClient({
    apiKey: 'ots_live_k',
    fetch: flaky,
    // The transport passes the resolved delay to sleep; capture it.
    sleepImpl: async (ms: number) => {
      sleeps.push(ms);
    },
    jitterImpl: () => 0,
  });

  const res = await client.systemOne({ state: 'x', questions: { q: noul('urgent?') } });
  assert.equal(calls, 2);
  assert.equal(res.model, 'jev-latest');
  // 2 seconds advised -> 2000ms, taken verbatim (well under the 60s ceiling).
  assert.deepEqual(sleeps, [2000]);
});

// ---------------------------------------------------------------------------
// Config: OPENJEV_* (primary) and TYPESAFE_* (alias) resolve through the client constructor
// ---------------------------------------------------------------------------

test('client resolves the OPENJEV_API_KEY primary env var from the environment', async () => {
  const prev = {
    a: process.env.TYPESAFE_API_KEY,
    b: process.env.typesafe_api_key,
    c: process.env.OPENJEV_API_KEY,
  };
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.typesafe_api_key;
  process.env.OPENJEV_API_KEY = 'ots_test_alias_key';
  try {
    const client = new OpenJevClient({ fetch: fixedFetch(200, OK_BODY) });
    const res = await client.systemOne({ state: 'x', questions: { q: noul('?') } });
    assert.equal(res.model, 'jev-latest');
  } finally {
    if (prev.a !== undefined) process.env.TYPESAFE_API_KEY = prev.a;
    if (prev.b !== undefined) process.env.typesafe_api_key = prev.b;
    if (prev.c !== undefined) process.env.OPENJEV_API_KEY = prev.c;
    else delete process.env.OPENJEV_API_KEY;
  }
});

// ---------------------------------------------------------------------------
// Client: batch() is a positional alias for systemOne()
// ---------------------------------------------------------------------------

test('batch() runs a positional multi-question request', async () => {
  const body = {
    model: 'jev-latest',
    answers: {
      is_spam: { type: 'noul', noul: 0.95 },
      lang: { type: 'choice', choice: 'en', probabilities: { en: 0.9 }, confidence: 0.9 },
    },
  };
  const client = new OpenJevClient({ apiKey: 'ots_live_k', fetch: fixedFetch(200, body) });
  const res = await client.batch('some text', {
    is_spam: noul('Is this spam?'),
    lang: choice('Language?', ['en', 'tr', 'other']),
  });
  assert.equal(res.answers.is_spam.type, 'noul');
  assert.equal(res.answers.lang.type, 'choice');
});

// ---------------------------------------------------------------------------
// Single-question helper + a Score primitive round trip
// ---------------------------------------------------------------------------

test('client.score() returns the single score answer', async () => {
  const body = {
    model: 'jev-latest',
    answers: {
      _q: {
        type: 'score',
        score: 2.1,
        legend: { '0': 'a', '1': 'b', '2': 'c' },
        probabilities: { '2': 0.8 },
        confidence: 0.82,
      },
    },
  };
  const client = new OpenJevClient({ apiKey: 'ots_live_k', fetch: fixedFetch(200, body) });
  const ans = await client.score('state', score('How intense?', ['a', 'b', 'c']));
  assert.equal(ans.type, 'score');
  assert.ok(Math.abs(ans.score - 2.1) < 1e-9);
});

// ---------------------------------------------------------------------------
// Module: support triage escalates a calm data-loss report
// ---------------------------------------------------------------------------

test('support-triage escalates a calm data-loss report and computes SLA', async () => {
  const answers = {
    urgency: {
      type: 'score',
      score: 2.9,
      legend: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' },
      probabilities: { '3': 0.85 },
      confidence: 0.9,
    },
    category: {
      type: 'choice',
      choice: 'data_loss',
      probabilities: { data_loss: 0.92 },
      confidence: 0.9,
    },
    sentiment: {
      type: 'choice',
      choice: 'neutral',
      probabilities: { neutral: 0.8 },
      confidence: 0.8,
    },
    routingTarget: {
      type: 'choice',
      choice: 'tier1_support',
      probabilities: { tier1_support: 0.7 },
      confidence: 0.7,
    },
  };
  const client = new OpenJevClient({
    apiKey: 'ots_live_k',
    fetch: fixedFetch(200, { model: 'jev-latest', answers }),
  });

  const result = await triageTicket(client, {
    id: 't1',
    subject: 'My project is gone',
    body: 'All of my saved documents have disappeared from the dashboard.',
    channel: 'email',
    plan: 'pro',
  });

  assert.equal(result.urgency, 'critical');
  assert.equal(result.category, 'data_loss');
  // Code override: data_loss always routes to engineering escalation.
  assert.equal(result.routingTarget, 'engineering_escalation');
  assert.equal(result.shouldEscalate, true);
  // critical urgency -> SLA 0 (handle now).
  assert.equal(result.suggestedSlaHours, 0);
});
