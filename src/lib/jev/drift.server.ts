import { getSql } from "@/lib/db";
import { getCalibration } from "./calibrations.server";
import {
  detectDrift,
  driftFingerprint,
  parseDriftThresholds,
  type DriftBaseline,
  type DriftObservation,
  type DriftReport,
  type DriftThresholds,
} from "./drift";
import { JevValidationError } from "./validate";
import { deliverToWebhook, getWebhook, type WebhookDelivery } from "./webhooks.server";

/**
 * Drift monitors (one per calibration). Each check compares the calibration's
 * held-out metrics with the shadow / labelled traffic that used it in the last
 * `window_days`, stores the report, and POSTs a signed `calibration.drift`
 * event to the chosen webhook when drift is found (and `calibration.drift_resolved`
 * once it clears). Checks run after every shadow request that names the
 * calibration (throttled) and on demand from the console / API.
 */

export const DRIFT_EVENT = "calibration.drift";
export const DRIFT_RESOLVED_EVENT = "calibration.drift_resolved";
/** Minimum spacing of automatic checks per monitor. */
export const DRIFT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Re-send an unchanged drift alert at most this often. */
export const DRIFT_REALERT_MS = 24 * 60 * 60 * 1000;
const MAX_OBSERVATIONS = 20_000;

export type DriftMonitor = {
  id: string;
  calibration_id: string;
  webhook_id: string;
  window_days: number;
  thresholds: DriftThresholds;
  active: boolean;
  last_checked_at: number | null;
  last_status: DriftReport["status"] | null;
  last_report: DriftReport | null;
  last_alert_at: number | null;
  created_at: number;
};

export type DriftCheckResult = {
  monitor: DriftMonitor;
  report: DriftReport;
  /** The webhook delivery, when an alert (or resolution) was sent. */
  delivery: WebhookDelivery | null;
  alerted: boolean;
};

type Row = {
  id: string;
  calibration_id: string;
  webhook_id: string;
  window_days: number;
  thresholds_json: unknown;
  active: boolean;
  last_checked_at: number | null;
  last_status: string | null;
  last_report_json: unknown;
  last_alert_at: number | null;
  last_alert_fingerprint: string | null;
  created_at: number;
};

const COLS = `id, calibration_id, webhook_id, window_days, thresholds_json, active,
  (extract(epoch from last_checked_at) * 1000)::bigint as last_checked_at,
  last_status, last_report_json,
  (extract(epoch from last_alert_at) * 1000)::bigint as last_alert_at,
  last_alert_fingerprint,
  (extract(epoch from created_at) * 1000)::bigint as created_at`;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function bad(message: string): never {
  throw new JevValidationError("invalid_drift_monitor", message);
}

function toMonitor(r: Row): DriftMonitor {
  let thresholds: DriftThresholds;
  try {
    thresholds = parseDriftThresholds(parseJson(r.thresholds_json, {}));
  } catch {
    thresholds = parseDriftThresholds({});
  }
  const status = r.last_status;
  return {
    id: r.id,
    calibration_id: r.calibration_id,
    webhook_id: r.webhook_id,
    window_days: Number(r.window_days),
    thresholds,
    active: Boolean(r.active),
    last_checked_at: r.last_checked_at == null ? null : Number(r.last_checked_at),
    last_status: status === "ok" || status === "drift" || status === "insufficient" ? status : null,
    last_report: parseJson<DriftReport | null>(r.last_report_json, null),
    last_alert_at: r.last_alert_at == null ? null : Number(r.last_alert_at),
    created_at: Number(r.created_at),
  };
}

async function loadRow(userId: string, where: string, value: string): Promise<Row | null> {
  const sql = await getSql();
  const rows = await sql.query<Row>(
    `select ${COLS} from drift_monitors where ${where} = $1 and user_id = $2`,
    [value, userId],
  );
  return rows[0] ?? null;
}

export async function listDriftMonitors(userId: string, calibrationId?: string): Promise<DriftMonitor[]> {
  const sql = await getSql();
  const rows = calibrationId
    ? await sql.query<Row>(
        `select ${COLS} from drift_monitors where user_id = $1 and calibration_id = $2`,
        [userId, calibrationId],
      )
    : await sql.query<Row>(
        `select ${COLS} from drift_monitors where user_id = $1 order by created_at desc limit 200`,
        [userId],
      );
  return rows.map(toMonitor);
}

export async function getDriftMonitor(userId: string, id: string): Promise<DriftMonitor | null> {
  const row = await loadRow(userId, "id", id);
  return row ? toMonitor(row) : null;
}

export type UpsertDriftMonitorInput = {
  calibration_id?: unknown;
  webhook_id?: unknown;
  window_days?: unknown;
  thresholds?: unknown;
  active?: unknown;
};

/** Create or update the monitor for a calibration (one per calibration). */
export async function upsertDriftMonitor(
  userId: string,
  input: UpsertDriftMonitorInput,
): Promise<DriftMonitor> {
  if (typeof input.calibration_id !== "string" || !input.calibration_id) bad("`calibration_id` is required.");
  if (typeof input.webhook_id !== "string" || !input.webhook_id) bad("`webhook_id` is required.");
  const calibration = await getCalibration(userId, input.calibration_id);
  if (!calibration) bad(`Calibration ${input.calibration_id} was not found for this account.`);
  const webhook = await getWebhook(userId, input.webhook_id);
  if (!webhook) bad(`Webhook ${input.webhook_id} was not found for this account.`);
  const windowDays = input.window_days === undefined ? 7 : input.window_days;
  if (typeof windowDays !== "number" || !Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) {
    bad("`window_days` must be an integer between 1 and 90.");
  }
  let thresholds: DriftThresholds;
  try {
    thresholds = parseDriftThresholds(input.thresholds);
  } catch (err) {
    bad(err instanceof Error ? err.message : "Invalid thresholds.");
  }
  if (input.active !== undefined && typeof input.active !== "boolean") bad("`active` must be a boolean.");
  const active = input.active ?? true;

  const sql = await getSql();
  const existing = await loadRow(userId, "calibration_id", input.calibration_id);
  if (existing) {
    await sql.query(
      `update drift_monitors
         set webhook_id = $3, window_days = $4, thresholds_json = $5::jsonb, active = $6, updated_at = now()
       where id = $1 and user_id = $2`,
      [existing.id, userId, input.webhook_id, windowDays, JSON.stringify(thresholds), active],
    );
  } else {
    await sql.query(
      `insert into drift_monitors (id, user_id, calibration_id, webhook_id, window_days, thresholds_json, active)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        `drm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        userId,
        input.calibration_id,
        input.webhook_id,
        windowDays,
        JSON.stringify(thresholds),
        active,
      ],
    );
  }
  const row = await loadRow(userId, "calibration_id", input.calibration_id);
  if (!row) throw new Error("Drift monitor was not persisted.");
  return toMonitor(row);
}

export async function deleteDriftMonitor(userId: string, id: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `delete from drift_monitors where id = $1 and user_id = $2 returning id`,
    [id, userId],
  );
  return rows.length > 0;
}

/** Baselines from a calibration's stored (held-out when available) after-metrics. */
async function baselinesFor(
  userId: string,
  calibrationId: string,
): Promise<{ name: string; model: string; baselines: Record<string, DriftBaseline> } | null> {
  const cal = await getCalibration(userId, calibrationId);
  if (!cal) return null;
  const baselines: Record<string, DriftBaseline> = {};
  for (const [qid, m] of Object.entries(cal.metrics)) {
    baselines[qid] = {
      accuracy: m.after.accuracy,
      avgConfidence: m.after.avgConfidence,
      n: m.heldout_n ?? m.n,
    };
  }
  return { name: cal.name, model: cal.model, baselines };
}

async function observationsFor(
  userId: string,
  calibrationId: string,
  windowDays: number,
): Promise<DriftObservation[]> {
  const sql = await getSql();
  const rows = await sql.query<{
    question_id: string;
    ours_confidence: number;
    agree: boolean;
    reference_kind: string;
  }>(
    `select question_id, ours_confidence, agree, reference_kind
     from shadow_pairs
     where user_id = $1 and calibration_id = $2
       and created_at >= now() - ($3::int * interval '1 day')
     order by created_at desc
     limit ${MAX_OBSERVATIONS}`,
    [userId, calibrationId, windowDays],
  );
  return rows.map((r) => ({
    question_id: r.question_id,
    confidence: Number(r.ours_confidence),
    correct: Boolean(r.agree),
    reference: r.reference_kind === "label" ? "label" : "llm",
  }));
}

/** One stored drift check (history for audit reports). */
export type DriftCheckRecord = {
  id: string;
  monitor_id: string;
  status: DriftReport["status"];
  drifted: string[];
  observations: number;
  alerted: boolean;
  checked_at: number;
};

/** Longest history an audit report includes. */
export const MAX_DRIFT_HISTORY = 200;

async function recordDriftCheck(
  userId: string,
  monitor: DriftMonitor,
  report: DriftReport,
  alerted: boolean,
): Promise<void> {
  const sql = await getSql();
  const id = `drc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await sql.query(
    `insert into drift_checks
       (id, user_id, monitor_id, calibration_id, status, drifted_json, observations, report_json, alerted)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)`,
    [
      id,
      userId,
      monitor.id,
      monitor.calibration_id,
      report.status,
      JSON.stringify(report.drifted),
      report.observations,
      JSON.stringify(report),
      alerted,
    ],
  );
}

/** Drift check history for a calibration, newest first. */
export async function listDriftChecks(
  userId: string,
  calibrationId: string,
  limit = MAX_DRIFT_HISTORY,
): Promise<DriftCheckRecord[]> {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string;
    monitor_id: string;
    status: string;
    drifted_json: unknown;
    observations: number;
    alerted: boolean;
    checked_at: number;
  }>(
    `select id, monitor_id, status, drifted_json, observations, alerted,
            (extract(epoch from checked_at) * 1000)::bigint as checked_at
     from drift_checks
     where user_id = $1 and calibration_id = $2
     order by checked_at desc
     limit $3`,
    [userId, calibrationId, Math.min(Math.max(limit, 1), MAX_DRIFT_HISTORY)],
  );
  return rows.map((r) => ({
    id: r.id,
    monitor_id: r.monitor_id,
    status: r.status === "drift" || r.status === "ok" ? r.status : "insufficient",
    drifted: parseJson<string[]>(r.drifted_json, []),
    observations: Number(r.observations),
    alerted: Boolean(r.alerted),
    checked_at: Number(r.checked_at),
  }));
}

/**
 * Run one monitor: detect, persist the report, and deliver an alert when drift
 * is new (different questions/signals than the last alert) or the last alert is
 * older than DRIFT_REALERT_MS. Sends a resolution event when drift clears.
 */
export async function checkDriftMonitor(userId: string, id: string): Promise<DriftCheckResult | null> {
  const row = await loadRow(userId, "id", id);
  if (!row) return null;
  const monitor = toMonitor(row);
  const base = await baselinesFor(userId, monitor.calibration_id);
  const sql = await getSql();
  if (!base) {
    const report: DriftReport = { status: "insufficient", drifted: [], questions: [], observations: 0 };
    await sql.query(
      `update drift_monitors set last_checked_at = now(), last_status = $3, last_report_json = $4::jsonb
       where id = $1 and user_id = $2`,
      [id, userId, "insufficient", JSON.stringify(report)],
    );
    await recordDriftCheck(userId, monitor, report, false);
    return { monitor, report, delivery: null, alerted: false };
  }
  const observations = await observationsFor(userId, monitor.calibration_id, monitor.window_days);
  const report = detectDrift(base.baselines, observations, monitor.thresholds);
  const fingerprint = driftFingerprint(report);
  const now = Date.now();

  let delivery: WebhookDelivery | null = null;
  let alerted = false;
  let nextFingerprint = row.last_alert_fingerprint;
  let alertedAt: number | null = null;
  const payload = {
    monitor_id: monitor.id,
    calibration_id: monitor.calibration_id,
    calibration_name: base.name,
    model: base.model,
    window_days: monitor.window_days,
    thresholds: monitor.thresholds,
    status: report.status,
    drifted: report.drifted,
    observations: report.observations,
    questions: report.questions,
    checked_at: new Date(now).toISOString(),
  };
  if (monitor.active && report.status === "drift") {
    const stale = monitor.last_alert_at == null || now - monitor.last_alert_at > DRIFT_REALERT_MS;
    if (fingerprint !== row.last_alert_fingerprint || stale) {
      delivery = await deliverToWebhook(userId, monitor.webhook_id, DRIFT_EVENT, payload);
      alerted = Boolean(delivery?.ok);
      if (alerted) {
        nextFingerprint = fingerprint;
        alertedAt = now;
      }
    }
  } else if (monitor.active && report.status === "ok" && row.last_alert_fingerprint) {
    delivery = await deliverToWebhook(userId, monitor.webhook_id, DRIFT_RESOLVED_EVENT, payload);
    if (delivery?.ok) nextFingerprint = null;
  }

  await sql.query(
    `update drift_monitors
       set last_checked_at = now(), last_status = $3, last_report_json = $4::jsonb,
           last_alert_fingerprint = $5,
           last_alert_at = case when $6::bigint is null then last_alert_at
                                else to_timestamp($6::bigint / 1000.0) end
     where id = $1 and user_id = $2`,
    [id, userId, report.status, JSON.stringify(report), nextFingerprint, alertedAt],
  );
  await recordDriftCheck(userId, monitor, report, alerted);
  const updated = await loadRow(userId, "id", id);
  return { monitor: updated ? toMonitor(updated) : monitor, report, delivery, alerted };
}

/**
 * Called after a shadow request that used `calibrationId`: runs the monitor
 * when one is active and was not checked in the last DRIFT_CHECK_INTERVAL_MS.
 * Never throws (shadow responses must not fail because of an alert).
 */
export async function checkDriftAfterShadow(userId: string, calibrationId: string): Promise<void> {
  try {
    const row = await loadRow(userId, "calibration_id", calibrationId);
    if (!row || !row.active) return;
    const last = row.last_checked_at == null ? 0 : Number(row.last_checked_at);
    if (Date.now() - last < DRIFT_CHECK_INTERVAL_MS) return;
    await checkDriftMonitor(userId, row.id);
  } catch (err) {
    console.error("[drift] automatic check failed", {
      calibrationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
