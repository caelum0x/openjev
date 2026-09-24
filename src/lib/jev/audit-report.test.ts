import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAuditReport,
  canonicalJson,
  escapeHtml,
  renderReportHtml,
  REPORT_SCHEMA,
  resolveSigningKey,
  signReport,
  verifyReport,
  type AuditReportInput,
} from "./audit-report.ts";

const KEY = { secret: "x".repeat(40), keyId: "rk_test" };

function input(overrides: Partial<AuditReportInput> = {}): AuditReportInput {
  return {
    issuedAt: new Date("2026-09-24T12:00:00Z"),
    issuer: "https://openjev.example",
    calibration: {
      id: "cal_1",
      name: "Support <intents>",
      model: "otsone-1",
      method: "auto",
      source: "upload",
      eval_run_id: null,
      sample_count: 400,
      created_at: Date.parse("2026-09-20T00:00:00Z"),
      maps: {
        intent: { method: "temperature", temperature: 1.73456 },
        "*": { method: "isotonic", knots: [[0, 0], [0.5, 0.4], [1, 1]] },
      },
      metrics: {
        "*": {
          n: 40,
          method: "isotonic",
          evaluation: "in_sample",
          before: { accuracy: 0.7, ece: 0.2, brier: 0.25, avgConfidence: 0.9 },
          after: { accuracy: 0.7, ece: 0.05, brier: 0.2, avgConfidence: 0.72 },
          recommended: null,
          target_precision: 0.95,
        },
        intent: {
          n: 360,
          method: "temperature",
          evaluation: "held_out",
          train_n: 270,
          heldout_n: 90,
          before: { accuracy: 0.86, ece: 0.12, brier: 0.14, avgConfidence: 0.97 },
          after: { accuracy: 0.86, ece: 0.03, brier: 0.11, avgConfidence: 0.87 },
          recommended: { threshold: 0.8, coverage: 0.7, precision: 0.96, escalated: 0.3, answered: 63 },
          target_precision: 0.95,
        },
      },
      skipped: { rare: "only 4 labels" },
    },
    monitor: {
      id: "drm_1",
      window_days: 7,
      active: true,
      thresholds: { min_samples: 30, accuracy_drop: 0.1, confidence_shift: 0.1, calibration_gap: 0.1 },
      last_status: "ok",
      last_checked_at: Date.parse("2026-09-24T10:00:00Z"),
    },
    driftHistory: [
      { status: "ok", drifted: [], observations: 120, alerted: false, checked_at: Date.parse("2026-09-24T10:00:00Z") },
      { status: "drift", drifted: ["intent"], observations: 90, alerted: true, checked_at: Date.parse("2026-09-22T10:00:00Z") },
    ],
    shadow: { window_days: 30, pairs: 500, agreement: 0.91, label_pairs: 80, label_agreement: 0.88 },
    ...overrides,
  };
}

test("canonical JSON sorts keys and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: [1, undefined, { d: 2, c: null }], u: undefined }), '{"a":[1,null,{"c":null,"d":2}],"b":1}');
  assert.equal(canonicalJson(Number.NaN), "null");
});

test("report bundles maps, metrics, thresholds, drift history and shadow stats", () => {
  const r = buildAuditReport(input());
  assert.equal(r.schema, REPORT_SCHEMA);
  assert.match(r.report_id, /^rep_[0-9a-f]{20}$/);
  assert.deepEqual(r.questions.map((q) => q.id), ["intent", "*"]);
  const intent = r.questions[0]!;
  assert.deepEqual(intent.map, { method: "temperature", temperature: 1.7346 });
  assert.equal(intent.evaluation, "held_out");
  assert.equal(intent.ece_change, -0.09);
  assert.deepEqual(intent.threshold.recommended, { threshold: 0.8, precision: 0.96, coverage: 0.7 });
  assert.deepEqual(r.questions[1]!.map, { method: "isotonic", knots: 3 });
  assert.deepEqual(r.skipped, [{ question_id: "rare", reason: "only 4 labels" }]);
  assert.equal(r.drift.checks, 2);
  assert.equal(r.drift.drift_events, 1);
  assert.equal(r.drift.history[0]!.checked_at, "2026-09-24T10:00:00.000Z");
  assert.equal(r.shadow?.agreement, 0.91);
  // pooled question: in-sample, small, no threshold
  assert.equal(r.limitations.length, 3);
  assert.ok(r.limitations.every((l) => l.startsWith("All other questions (pooled)")));
});

test("limitations call out a missing monitor and missing shadow traffic", () => {
  const r = buildAuditReport(input({ monitor: null, driftHistory: [], shadow: null }));
  assert.ok(r.limitations.some((l) => l.includes("No drift monitor")));
  assert.ok(r.limitations.some((l) => l.includes("No shadow-mode traffic")));
  assert.equal(r.drift.monitor, null);
});

test("the report id is stable for identical input", () => {
  assert.equal(buildAuditReport(input()).report_id, buildAuditReport(input()).report_id);
  assert.notEqual(
    buildAuditReport(input()).report_id,
    buildAuditReport(input({ issuedAt: new Date("2026-09-25T00:00:00Z") })).report_id,
  );
});

test("sign then verify round-trips through JSON", () => {
  const signed = signReport(buildAuditReport(input()), KEY);
  const parsed = JSON.parse(JSON.stringify(signed));
  const result = verifyReport(parsed, KEY);
  assert.deepEqual(result, {
    valid: true,
    report_id: signed.report_id,
    calibration_id: "cal_1",
    issued_at: "2026-09-24T12:00:00.000Z",
  });
});

test("verification rejects tampering, other keys and malformed input", () => {
  const signed = signReport(buildAuditReport(input()), KEY);
  const tampered = JSON.parse(JSON.stringify(signed));
  tampered.questions[0].calibrated.ece = 0.001;
  assert.deepEqual(verifyReport(tampered, KEY), { valid: false, reason: "bad_signature" });
  assert.deepEqual(verifyReport(signed, { secret: "y".repeat(40), keyId: "rk_other" }), {
    valid: false,
    reason: "unknown_key",
  });
  assert.deepEqual(verifyReport(signed, { secret: "y".repeat(40), keyId: "rk_test" }), {
    valid: false,
    reason: "bad_signature",
  });
  assert.deepEqual(verifyReport(null, KEY), { valid: false, reason: "malformed" });
  assert.deepEqual(verifyReport([], KEY), { valid: false, reason: "malformed" });
  assert.deepEqual(verifyReport({ ...signed, signature: { alg: "HMAC-SHA256", key_id: "rk_test", value: "zz" } }, KEY), {
    valid: false,
    reason: "malformed",
  });
  assert.deepEqual(verifyReport({ ...signed, schema: "other" }, KEY), { valid: false, reason: "malformed" });
});

test("signing key comes from env, never a default", () => {
  assert.equal(resolveSigningKey({}), null);
  assert.equal(resolveSigningKey({ OPENJEV_REPORT_SIGNING_SECRET: "short" }), null);
  const explicit = resolveSigningKey({ OPENJEV_REPORT_SIGNING_SECRET: "s".repeat(32) });
  assert.ok(explicit && explicit.secret === "s".repeat(32) && /^rk_[0-9a-f]{12}$/.test(explicit.keyId));
  const derived = resolveSigningKey({ BETTER_AUTH_SECRET: "auth-secret" });
  assert.ok(derived && derived.secret !== "auth-secret" && derived.secret.length === 64);
  assert.notEqual(derived.keyId, explicit.keyId);
  // explicit wins over derived
  assert.equal(
    resolveSigningKey({ OPENJEV_REPORT_SIGNING_SECRET: "s".repeat(32), BETTER_AUTH_SECRET: "a" })?.secret,
    "s".repeat(32),
  );
});

test("HTML is printable and escapes user-provided names", () => {
  const html = renderReportHtml(signReport(buildAuditReport(input()), KEY));
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Support &lt;intents&gt;"));
  assert.ok(!html.includes("Support <intents>"));
  assert.ok(html.includes("temperature scaling, T = 1.7346"));
  assert.ok(html.includes("precision 96.0%, coverage 70.0%"));
  assert.ok(html.includes("2 checks recorded, 1 with drift."));
  assert.ok(html.includes("500 shadow comparisons"));
  assert.ok(html.includes("@media print"));
  assert.equal(escapeHtml(`"'&`), "&quot;&#39;&amp;");
});
