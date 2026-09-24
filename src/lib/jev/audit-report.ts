/**
 * Signed calibration audit reports (trust layer P3.4, Team plan).
 *
 * A report bundles what a risk or compliance reviewer needs to judge one
 * calibration: the fitted map per question, raw vs calibrated accuracy / ECE /
 * Brier (held-out when there were enough labels), the recommended threshold
 * for the target precision, the drift monitor and its check history, and
 * shadow-mode agreement on live traffic. It also lists its own limitations
 * (in-sample numbers, small samples, no monitor) so it cannot oversell.
 *
 * The body is serialised as canonical JSON (sorted keys, no whitespace) and
 * signed with HMAC-SHA256. Anyone holding the report can ask the issuing
 * server to verify it (POST /v1/reports/verify); the secret never leaves the
 * server and is read from the environment.
 *
 * Pure apart from node:crypto: no DB, no network, unit-tested with node:test.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CalibrationMaps, QuestionCalibrationMap, ThresholdPoint } from "./calibration-fit.ts";

export const REPORT_SCHEMA = "openjev.audit-report/v1";
export const SIGNATURE_ALG = "HMAC-SHA256";
/** Domain-separation label when the key is derived from BETTER_AUTH_SECRET. */
const DERIVE_LABEL = "openjev-audit-report-v1";
/** Samples under this count are flagged as a limitation. */
export const SMALL_SAMPLE = 100;

// ---------------------------------------------------------------------------
// Inputs (plain data gathered by audit-report.server.ts)
// ---------------------------------------------------------------------------

type Stats = { accuracy: number; ece: number; brier: number; avgConfidence: number };

export type ReportQuestionMetrics = {
  n: number;
  method: "temperature" | "isotonic";
  evaluation?: "held_out" | "in_sample";
  train_n?: number;
  heldout_n?: number;
  before: Stats;
  after: Stats;
  recommended: ThresholdPoint | null;
  target_precision: number;
};

export type ReportCalibration = {
  id: string;
  name: string;
  model: string;
  method: string;
  source: "upload" | "eval_run";
  eval_run_id: string | null;
  sample_count: number;
  created_at: number;
  maps: CalibrationMaps;
  metrics: Record<string, ReportQuestionMetrics>;
  skipped: Record<string, string>;
};

export type ReportMonitor = {
  id: string;
  window_days: number;
  active: boolean;
  thresholds: {
    min_samples: number;
    accuracy_drop: number;
    confidence_shift: number;
    calibration_gap: number;
  };
  last_status: "ok" | "drift" | "insufficient" | null;
  last_checked_at: number | null;
};

export type ReportDriftCheck = {
  status: "ok" | "drift" | "insufficient";
  drifted: string[];
  observations: number;
  alerted: boolean;
  checked_at: number;
};

export type ReportShadowStats = {
  window_days: number;
  pairs: number;
  agreement: number | null;
  label_pairs: number;
  label_agreement: number | null;
};

export type AuditReportInput = {
  calibration: ReportCalibration;
  monitor: ReportMonitor | null;
  driftHistory: readonly ReportDriftCheck[];
  shadow: ReportShadowStats | null;
  issuedAt: Date;
  /** Public origin of the issuing server, when configured. */
  issuer: string | null;
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

type ReportStats = { accuracy: number; ece: number; brier: number; avg_confidence: number };

export type ReportQuestion = {
  id: string;
  label: string;
  map: { method: "temperature" | "isotonic"; temperature?: number; knots?: number };
  evaluation: "held_out" | "in_sample" | "unknown";
  labels: number;
  train_labels: number | null;
  heldout_labels: number | null;
  raw: ReportStats;
  calibrated: ReportStats;
  ece_change: number;
  brier_change: number;
  threshold: {
    target_precision: number;
    recommended: { threshold: number; precision: number | null; coverage: number } | null;
  };
};

export type AuditReportBody = {
  schema: typeof REPORT_SCHEMA;
  report_id: string;
  issued_at: string;
  issuer: string | null;
  calibration: {
    id: string;
    name: string;
    model: string;
    method: string;
    source: "upload" | "eval_run";
    eval_run_id: string | null;
    labels: number;
    created_at: string;
  };
  questions: ReportQuestion[];
  skipped: Array<{ question_id: string; reason: string }>;
  drift: {
    monitor: {
      id: string;
      window_days: number;
      active: boolean;
      thresholds: ReportMonitor["thresholds"];
      last_status: ReportMonitor["last_status"];
      last_checked_at: string | null;
    } | null;
    checks: number;
    drift_events: number;
    history: Array<{
      checked_at: string;
      status: string;
      drifted: string[];
      observations: number;
      alerted: boolean;
    }>;
  };
  shadow: ReportShadowStats | null;
  limitations: string[];
};

export type ReportSignature = {
  alg: typeof SIGNATURE_ALG;
  key_id: string;
  value: string;
};

export type SignedAuditReport = AuditReportBody & { signature: ReportSignature };

export type SigningKey = { secret: string; keyId: string };

// ---------------------------------------------------------------------------
// Canonical JSON + signing
// ---------------------------------------------------------------------------

/** Deterministic JSON: object keys sorted, no whitespace, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return "null";
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

/**
 * The signing key from the environment: OPENJEV_REPORT_SIGNING_SECRET, or a key
 * derived from BETTER_AUTH_SECRET with a domain-separation label. Null when
 * neither is set (the route then answers 503 instead of issuing unsigned data).
 */
export function resolveSigningKey(env: Record<string, string | undefined>): SigningKey | null {
  const explicit = env.OPENJEV_REPORT_SIGNING_SECRET?.trim();
  if (explicit) {
    if (explicit.length < 32) return null;
    return { secret: explicit, keyId: `rk_${sha256Hex(`kid:${explicit}`).slice(0, 12)}` };
  }
  const auth = env.BETTER_AUTH_SECRET?.trim();
  if (auth) {
    const derived = createHmac("sha256", auth).update(DERIVE_LABEL).digest("hex");
    return { secret: derived, keyId: `rk_${sha256Hex(`kid:${derived}`).slice(0, 12)}` };
  }
  return null;
}

function mac(body: AuditReportBody, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(body)).digest("hex");
}

export function signReport(body: AuditReportBody, key: SigningKey): SignedAuditReport {
  return {
    ...body,
    signature: { alg: SIGNATURE_ALG, key_id: key.keyId, value: mac(body, key.secret) },
  };
}

export type VerifyResult =
  | { valid: true; report_id: string; calibration_id: string; issued_at: string }
  | { valid: false; reason: "malformed" | "unknown_key" | "bad_signature" };

/** Verify a signed report against the server key. Constant-time comparison. */
export function verifyReport(report: unknown, key: SigningKey): VerifyResult {
  if (!report || typeof report !== "object" || Array.isArray(report))
    return { valid: false, reason: "malformed" };
  const { signature, ...body } = report as Record<string, unknown>;
  const sig = signature as Partial<ReportSignature> | undefined;
  if (
    !sig ||
    sig.alg !== SIGNATURE_ALG ||
    typeof sig.value !== "string" ||
    !/^[0-9a-f]{64}$/.test(sig.value) ||
    body.schema !== REPORT_SCHEMA
  ) {
    return { valid: false, reason: "malformed" };
  }
  if (sig.key_id !== key.keyId) return { valid: false, reason: "unknown_key" };
  const expected = Buffer.from(mac(body as AuditReportBody, key.secret), "hex");
  const given = Buffer.from(sig.value, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { valid: false, reason: "bad_signature" };
  }
  const b = body as AuditReportBody;
  return {
    valid: true,
    report_id: b.report_id,
    calibration_id: b.calibration?.id,
    issued_at: b.issued_at,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const iso = (ms: number): string => new Date(ms).toISOString();

function stats(s: Stats): ReportStats {
  return {
    accuracy: r4(s.accuracy),
    ece: r4(s.ece),
    brier: r4(s.brier),
    avg_confidence: r4(s.avgConfidence),
  };
}

function describeMap(
  map: QuestionCalibrationMap | undefined,
  fallback: "temperature" | "isotonic",
): ReportQuestion["map"] {
  if (!map) return { method: fallback };
  if (map.method === "temperature")
    return { method: "temperature", temperature: r4(map.temperature) };
  return { method: "isotonic", knots: map.knots.length };
}

function buildQuestion(
  id: string,
  m: ReportQuestionMetrics,
  map: QuestionCalibrationMap | undefined,
): ReportQuestion {
  const rec = m.recommended;
  return {
    id,
    label: id === "*" ? "All other questions (pooled)" : id,
    map: describeMap(map, m.method),
    evaluation: m.evaluation ?? "unknown",
    labels: m.n,
    train_labels: m.train_n ?? null,
    heldout_labels: m.heldout_n ?? null,
    raw: stats(m.before),
    calibrated: stats(m.after),
    ece_change: r4(m.after.ece - m.before.ece),
    brier_change: r4(m.after.brier - m.before.brier),
    threshold: {
      target_precision: m.target_precision,
      recommended: rec
        ? { threshold: rec.threshold, precision: rec.precision, coverage: rec.coverage }
        : null,
    },
  };
}

function limitationsFor(input: AuditReportInput, questions: readonly ReportQuestion[]): string[] {
  const out: string[] = [];
  for (const q of questions) {
    if (q.evaluation !== "held_out") {
      out.push(
        `${q.label}: metrics are in-sample (measured on the labels the map was fitted on), so they are optimistic.`,
      );
    }
    if (q.labels < SMALL_SAMPLE) {
      out.push(
        `${q.label}: only ${q.labels} labels; ECE and Brier have wide error bars at this size.`,
      );
    }
    if (q.threshold.recommended === null) {
      out.push(
        `${q.label}: no threshold reached the ${q.threshold.target_precision} precision target on these labels.`,
      );
    }
  }
  if (!input.monitor)
    out.push("No drift monitor is configured, so live-traffic drift is not being checked.");
  else if (!input.monitor.active) out.push("The drift monitor exists but is paused.");
  if (!input.shadow || input.shadow.pairs === 0) {
    out.push(
      "No shadow-mode traffic used this calibration in the window, so there is no live agreement measurement.",
    );
  }
  return out;
}

export function buildAuditReport(input: AuditReportInput): AuditReportBody {
  const { calibration: c } = input;
  const questions = Object.entries(c.metrics)
    .sort(([a], [b]) => (a === "*" ? 1 : b === "*" ? -1 : a.localeCompare(b)))
    .map(([id, m]) => buildQuestion(id, m, c.maps[id]));
  const history = [...input.driftHistory]
    .sort((a, b) => b.checked_at - a.checked_at)
    .map((h) => ({
      checked_at: iso(h.checked_at),
      status: h.status,
      drifted: [...h.drifted],
      observations: h.observations,
      alerted: h.alerted,
    }));
  const withoutId: Omit<AuditReportBody, "report_id"> = {
    schema: REPORT_SCHEMA,
    issued_at: input.issuedAt.toISOString(),
    issuer: input.issuer,
    calibration: {
      id: c.id,
      name: c.name,
      model: c.model,
      method: c.method,
      source: c.source,
      eval_run_id: c.eval_run_id,
      labels: c.sample_count,
      created_at: iso(c.created_at),
    },
    questions,
    skipped: Object.entries(c.skipped).map(([question_id, reason]) => ({ question_id, reason })),
    drift: {
      monitor: input.monitor
        ? {
            id: input.monitor.id,
            window_days: input.monitor.window_days,
            active: input.monitor.active,
            thresholds: { ...input.monitor.thresholds },
            last_status: input.monitor.last_status,
            last_checked_at:
              input.monitor.last_checked_at == null ? null : iso(input.monitor.last_checked_at),
          }
        : null,
      checks: history.length,
      drift_events: history.filter((h) => h.status === "drift").length,
      history,
    },
    shadow: input.shadow ? { ...input.shadow } : null,
    limitations: limitationsFor(input, questions),
  };
  const reportId = `rep_${sha256Hex(canonicalJson(withoutId)).slice(0, 20)}`;
  return { ...withoutId, report_id: reportId };
}

// ---------------------------------------------------------------------------
// Printable HTML
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const pct = (x: number | null): string => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const num = (x: number): string => x.toFixed(3);

function questionHtml(q: ReportQuestion): string {
  const map =
    q.map.method === "temperature"
      ? `temperature scaling, T = ${q.map.temperature ?? "n/a"}`
      : `isotonic regression${q.map.knots ? `, ${q.map.knots} knots` : ""}`;
  const measured =
    q.evaluation === "held_out"
      ? `held-out: fitted on ${q.train_labels} labels, measured on ${q.heldout_labels} unseen labels`
      : q.evaluation === "in_sample"
        ? "in-sample (optimistic)"
        : "measurement method not recorded";
  const rec = q.threshold.recommended;
  const threshold = rec
    ? `Act automatically at confidence &ge; ${rec.threshold}: precision ${pct(rec.precision)}, coverage ${pct(rec.coverage)} (target ${pct(q.threshold.target_precision)}).`
    : `No threshold reached the ${pct(q.threshold.target_precision)} precision target.`;
  return `<section class="q">
<h3>${escapeHtml(q.label)}</h3>
<p class="muted">${escapeHtml(map)} &middot; ${q.labels} labels &middot; ${escapeHtml(measured)}</p>
<table><thead><tr><th></th><th>Accuracy</th><th>Mean confidence</th><th>ECE</th><th>Brier</th></tr></thead>
<tbody>
<tr><td>Raw</td><td>${pct(q.raw.accuracy)}</td><td>${num(q.raw.avg_confidence)}</td><td>${num(q.raw.ece)}</td><td>${num(q.raw.brier)}</td></tr>
<tr><td>Calibrated</td><td>${pct(q.calibrated.accuracy)}</td><td>${num(q.calibrated.avg_confidence)}</td><td>${num(q.calibrated.ece)}</td><td>${num(q.calibrated.brier)}</td></tr>
</tbody></table>
<p>${threshold}</p>
</section>`;
}

function driftHtml(r: SignedAuditReport): string {
  const m = r.drift.monitor;
  if (!m) return "<p>No drift monitor configured.</p>";
  const rows = r.drift.history
    .slice(0, 50)
    .map(
      (h) =>
        `<tr><td>${escapeHtml(h.checked_at)}</td><td>${escapeHtml(h.status)}</td><td>${h.observations}</td><td>${escapeHtml(h.drifted.join(", ") || "-")}</td></tr>`,
    )
    .join("\n");
  return `<p>Monitor ${escapeHtml(m.id)} &middot; ${m.active ? "active" : "paused"} &middot; ${m.window_days}-day window &middot; alerts on accuracy drop &gt; ${m.thresholds.accuracy_drop}, confidence shift &gt; ${m.thresholds.confidence_shift}, calibration gap &gt; ${m.thresholds.calibration_gap} (min ${m.thresholds.min_samples} samples).</p>
<p>${r.drift.checks} checks recorded, ${r.drift.drift_events} with drift.</p>
${rows ? `<table><thead><tr><th>Checked</th><th>Status</th><th>Observations</th><th>Drifted questions</th></tr></thead><tbody>\n${rows}\n</tbody></table>` : ""}`;
}

export function renderReportHtml(r: SignedAuditReport): string {
  const s = r.shadow;
  const shadow =
    s && s.pairs > 0
      ? `<p>${s.pairs} shadow comparisons in the last ${s.window_days} days, agreement ${pct(s.agreement)}; ${s.label_pairs} against human labels, accuracy ${pct(s.label_agreement)}.</p>`
      : "<p>No shadow-mode traffic used this calibration in the window.</p>";
  const skipped = r.skipped.length
    ? `<p>Not individually fitted: ${r.skipped.map((x) => `${escapeHtml(x.question_id)} (${escapeHtml(x.reason)})`).join("; ")}.</p>`
    : "";
  const limitations = r.limitations.length
    ? `<ul>${r.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
    : "<p>None recorded.</p>";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Calibration audit report: ${escapeHtml(r.calibration.name)}</title>
<meta name="robots" content="noindex">
<style>
body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:860px;margin:32px auto;padding:0 20px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
h3{font-size:14px;margin:18px 0 4px;font-family:ui-monospace,monospace}
table{border-collapse:collapse;width:100%;margin:8px 0;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:4px 10px 4px 0;border-bottom:1px solid #eee}th{font-size:11px;text-transform:uppercase;color:#666}
.muted{color:#555}.sig{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all;color:#333}
@media print{body{margin:0}section.q{break-inside:avoid}}
</style></head><body>
<p class="muted">OpenJev calibration audit report &middot; ${escapeHtml(r.report_id)}</p>
<h1>${escapeHtml(r.calibration.name)}</h1>
<p class="muted">${escapeHtml(r.calibration.id)} &middot; model ${escapeHtml(r.calibration.model)} &middot; ${r.calibration.labels} labels (${r.calibration.source === "eval_run" ? `from eval run ${escapeHtml(r.calibration.eval_run_id ?? "")}` : "uploaded"}) &middot; fitted ${escapeHtml(r.calibration.created_at)}</p>
<p class="muted">Issued ${escapeHtml(r.issued_at)}${r.issuer ? ` by ${escapeHtml(r.issuer)}` : ""}.</p>
<h2>Per-question calibration</h2>
${r.questions.map(questionHtml).join("\n")}
${skipped}
<h2>Drift monitoring</h2>
${driftHtml(r)}
<h2>Live traffic (shadow mode)</h2>
${shadow}
<h2>Limitations</h2>
${limitations}
<h2>Signature</h2>
<p>${escapeHtml(r.signature.alg)} over the canonical JSON of this report (keys sorted, no whitespace, signature field excluded). Key ${escapeHtml(r.signature.key_id)}. Verify with <code>POST /v1/reports/verify</code> on the issuing server, sending the JSON form of this report.</p>
<p class="sig">${escapeHtml(r.signature.value)}</p>
</body></html>`;
}
