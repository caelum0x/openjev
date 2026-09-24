import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenJevClient } from '../src/client.ts';
import { triageDailyScore, judgeSeedRetraction } from '../modules/flowblast-anticheat.ts';
import { judgePolicy, judgeMigrationRisk } from '../modules/aegis-policy-risk.ts';
import { scoreAdCreative } from '../modules/meta-ads.ts';

/** Build a client whose server returns a fixed answers map. */
function clientReturning(answers: Record<string, unknown>): OpenJevClient {
  const impl: typeof fetch = (async () =>
    new Response(JSON.stringify({ model: 'otsone-latest', answers }), { status: 200 })) as unknown as typeof fetch;
  return new OpenJevClient({ apiKey: 'k', fetchImpl: impl, sleepImpl: async () => {} });
}

test('flowblast: high suspicion escalates to a sim replay', async () => {
  const client = clientReturning({
    suspicion: { type: 'score', score: 2.8, legend: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' }, probabilities: {}, confidence: 0.9 },
    impossible: { type: 'noul', noul: 0.2 },
  });
  const v = await triageDailyScore(client, { seed: 's', mode: 'classic', score: 999999, hasTrace: true });
  assert.equal(v.replayNeeded, true);
  assert.equal(v.accept, false);
});

test('flowblast: ordinary score is accepted without replay', async () => {
  const client = clientReturning({
    suspicion: { type: 'score', score: 0.3, legend: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' }, probabilities: {}, confidence: 0.95 },
    impossible: { type: 'noul', noul: 0.02 },
  });
  const v = await triageDailyScore(client, { seed: 's', mode: 'classic', score: 4200, hasTrace: true, percentile: 40 });
  assert.equal(v.accept, true);
  assert.equal(v.replayNeeded, false);
});

test('flowblast: retraction respects the deterministic window guardrail', async () => {
  // Outside the 2h window -> never call the model, never retract.
  const client = clientReturning({});
  const v = await judgeSeedRetraction(client, {
    date: '2026-09-21',
    observedBrickRate: 0.4,
    sampleSize: 5000,
    hoursSincePublish: 5,
  });
  assert.equal(v.retract, false);
  assert.match(v.reason, /window/);
});

test('aegis: USING(true) is forced dangerous and blocks apply', async () => {
  const client = clientReturning({
    severity: { type: 'choice', choice: 'safe', probabilities: { safe: 0.9 }, confidence: 0.9 },
    publicReadAll: { type: 'noul', noul: 0.1 },
    exposesServiceRole: { type: 'noul', noul: 0.1 },
    exposureScale: { type: 'score', score: 1, legend: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' }, probabilities: {}, confidence: 0.9 },
  });
  const v = await judgePolicy(client, {
    table: 'profiles',
    schema: 'public',
    command: 'select',
    usingExpr: 'true',
    roles: ['anon', 'authenticated'],
    anonReachable: true,
  });
  // Hard rule overrides the model's "safe".
  assert.equal(v.severity, 'dangerous');
  assert.equal(v.blockApply, true);
  assert.ok(v.findings.length >= 1);
});

test('aegis: scoped policy is judged safe and does not block', async () => {
  const client = clientReturning({
    severity: { type: 'choice', choice: 'safe', probabilities: { safe: 0.95 }, confidence: 0.95 },
    publicReadAll: { type: 'noul', noul: 0.02 },
    exposesServiceRole: { type: 'noul', noul: 0.02 },
    exposureScale: { type: 'score', score: 1, legend: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' }, probabilities: {}, confidence: 0.9 },
  });
  const v = await judgePolicy(client, {
    table: 'profiles',
    schema: 'public',
    command: 'select',
    usingExpr: 'auth.uid() = user_id',
    roles: ['authenticated'],
    anonReachable: true,
  });
  assert.equal(v.severity, 'safe');
  assert.equal(v.blockApply, false);
});

test('aegis: destructive migration always requires human approval', async () => {
  const client = clientReturning({});
  const v = await judgeMigrationRisk(client, {
    summary: 'drop old table',
    statements: ['DROP TABLE legacy;'],
    touchesAuthOrStorage: false,
    dropsOrTruncates: true,
  });
  assert.equal(v.requiresHumanApproval, true);
  assert.equal(v.risk, 3);
});

test('ads: composite score and winner flag', async () => {
  const hi = (s: number) => ({ type: 'score', score: s, legend: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' }, probabilities: {}, confidence: 0.9 });
  const client = clientReturning({
    hook: hi(3),
    clarity: hi(3),
    desire: hi(3),
    ctaStrength: hi(2),
    scrollStopping: hi(3),
    likelyWinner: { type: 'noul', noul: 0.9 },
    policyRisk: { type: 'noul', noul: 0.05 },
  });
  const r = await scoreAdCreative(client, {
    id: 'ad1',
    product: 'FlowBlast',
    audience: 'casual puzzle players',
    platform: 'reels',
    format: 'video',
    primaryText: 'The puzzle that charges up. Can you keep the flow?',
    cta: 'Play free',
  });
  assert.ok(r.composite > 0.8);
  assert.equal(r.likelyWinner, true);
  assert.equal(r.policyRisk, false);
});
