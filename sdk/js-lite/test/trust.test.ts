import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenJevClient, OpenJevError } from '../src/client.ts';
import { choice, withAbstain, PrimitiveError } from '../src/primitives.ts';

type Call = { url: string; init: RequestInit };

function recordingFetch(body: unknown, calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const ANSWER = {
  model: 'auto',
  answers: {
    intent: { type: 'choice', choice: '__none__', probabilities: { __none__: 0.8 }, confidence: 0.2, ood: 0.9, abstained: true, abstain_reason: 'out_of_scope' },
  },
  calibration: { id: 'cal_abc123', method: 'temperature', questions: ['intent'] },
};

test('systemOne forwards calibration_id, abstain and escalate_below', async () => {
  const calls: Call[] = [];
  const client = new OpenJevClient({ apiKey: 'k', baseURL: 'http://x', fetch: recordingFetch(ANSWER, calls), maxRetries: 0 });
  const res = await client.systemOne({
    model: 'auto',
    state: 'weather on mars',
    calibration_id: 'cal_abc123',
    escalate_below: 0.6,
    questions: { intent: withAbstain(choice('Intent?', ['refund', 'status']), 0.4) },
  });
  const sent = JSON.parse(String(calls[0]!.init.body));
  assert.equal(sent.model, 'auto');
  assert.equal(sent.calibration_id, 'cal_abc123');
  assert.equal(sent.escalate_below, 0.6);
  assert.equal('abstain' in sent, false);
  assert.deepEqual([sent.questions.intent.abstain, sent.questions.intent.abstain_below], [true, 0.4]);
  assert.equal(res.answers.intent.abstained, true);
  assert.equal(res.answers.intent.abstain_reason, 'out_of_scope');
  assert.equal(res.calibration?.id, 'cal_abc123');
});

test('withAbstain never mutates and validates its threshold', () => {
  const q = choice('Intent?', ['a', 'b']);
  const next = withAbstain(q);
  assert.equal(next.abstain, true);
  assert.equal((q as { abstain?: boolean }).abstain, undefined);
  assert.throws(() => withAbstain(q, 2), PrimitiveError);
});

test('shadow posts the incumbent and unwraps data', async () => {
  const calls: Call[] = [];
  const result = { batch_id: 'shb_1', incumbent: { name: 'humans', source: 'caller', kind: 'label' }, calibration_id: null, ours: ANSWER, comparisons: [], agreement: 1 };
  const client = new OpenJevClient({ apiKey: 'k', baseURL: 'http://x', fetch: recordingFetch({ data: result }, calls), maxRetries: 0 });
  const r = await client.shadow({
    state: 'refund me',
    questions: { intent: choice('Intent?', ['refund', 'status']) },
    incumbent: { name: 'humans', kind: 'label', answers: { intent: 'refund' } },
  });
  assert.equal(calls[0]!.url, 'http://x/v1/shadow');
  assert.equal(JSON.parse(String(calls[0]!.init.body)).incumbent.kind, 'label');
  assert.equal(r.batch_id, 'shb_1');
});

test('shadowSummary uses GET without a body and rejects bad envelopes', async () => {
  const calls: Call[] = [];
  const client = new OpenJevClient({ apiKey: 'k', baseURL: 'http://x', fetch: recordingFetch({ data: { total: 3 } }, calls), maxRetries: 0 });
  const s = await client.shadowSummary({ days: 7 });
  assert.equal(calls[0]!.url, 'http://x/v1/shadow?days=7');
  assert.equal(calls[0]!.init.method, 'GET');
  assert.equal(calls[0]!.init.body, undefined);
  assert.equal(s.total, 3);
  const bad = new OpenJevClient({ apiKey: 'k', baseURL: 'http://x', fetch: recordingFetch({ nope: 1 }, []), maxRetries: 0 });
  await assert.rejects(bad.shadowSummary(), OpenJevError);
});
