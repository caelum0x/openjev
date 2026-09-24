import { getSql } from "@/lib/db";
import { SITE_URL, SITE_URL_CONFIGURED } from "@/lib/seo/site";
import {
  buildAuditReport,
  resolveSigningKey,
  signReport,
  type ReportShadowStats,
  type SignedAuditReport,
  type SigningKey,
} from "./audit-report";
import { getCalibration } from "./calibrations.server";
import { listDriftChecks, listDriftMonitors } from "./drift.server";
import { FEATURE_MIN_PLAN, planAllows, planById, planForQuota } from "./plans";
import { getUserQuota } from "./quota.server";

/**
 * Data gathering + plan gating for signed calibration audit reports. The pure
 * build/sign/render logic lives in audit-report.ts; this module reads the
 * calibration, its drift monitor and check history, and shadow-mode agreement,
 * all scoped to `userId`.
 */

/** Shadow-mode window summarised in a report. */
export const SHADOW_WINDOW_DAYS = 30;

export class ReportError extends Error {
  constructor(
    readonly status: 402 | 404 | 503,
    readonly type: "plan_required" | "not_found" | "report_signing_not_configured",
    message: string,
  ) {
    super(message);
  }
}

export function signingKeyOrThrow(): SigningKey {
  const key = resolveSigningKey(process.env);
  if (!key) {
    throw new ReportError(
      503,
      "report_signing_not_configured",
      "Audit reports are signed. Set OPENJEV_REPORT_SIGNING_SECRET (32+ characters) or BETTER_AUTH_SECRET on the server.",
    );
  }
  return key;
}

async function assertPlan(userId: string): Promise<void> {
  const quota = await getUserQuota(userId);
  const plan = planForQuota(quota.monthly_quota);
  if (!planAllows(plan, "audit_reports")) {
    const needed = planById(FEATURE_MIN_PLAN.audit_reports);
    throw new ReportError(
      402,
      "plan_required",
      `Signed audit reports are part of the ${needed?.name ?? "Team"} plan. You are on ${plan.name}; upgrade on /pricing or self-host OpenJev to use them for free.`,
    );
  }
}

async function shadowStats(userId: string, calibrationId: string): Promise<ReportShadowStats> {
  const sql = await getSql();
  const rows = await sql.query<{
    pairs: number;
    agreed: number;
    label_pairs: number;
    label_agreed: number;
  }>(
    `select count(*)::int as pairs,
            count(*) filter (where agree)::int as agreed,
            count(*) filter (where reference_kind = 'label')::int as label_pairs,
            count(*) filter (where reference_kind = 'label' and agree)::int as label_agreed
     from shadow_pairs
     where user_id = $1 and calibration_id = $2
       and created_at >= now() - ($3::int * interval '1 day')`,
    [userId, calibrationId, SHADOW_WINDOW_DAYS],
  );
  const r = rows[0] ?? { pairs: 0, agreed: 0, label_pairs: 0, label_agreed: 0 };
  const ratio = (a: number, b: number): number | null =>
    b > 0 ? Math.round((a / b) * 1e4) / 1e4 : null;
  return {
    window_days: SHADOW_WINDOW_DAYS,
    pairs: Number(r.pairs),
    agreement: ratio(Number(r.agreed), Number(r.pairs)),
    label_pairs: Number(r.label_pairs),
    label_agreement: ratio(Number(r.label_agreed), Number(r.label_pairs)),
  };
}

/** Build and sign the audit report for one calibration. Throws ReportError. */
export async function issueAuditReport(
  userId: string,
  calibrationId: string,
): Promise<SignedAuditReport> {
  await assertPlan(userId);
  const key = signingKeyOrThrow();
  const calibration = await getCalibration(userId, calibrationId);
  if (!calibration) throw new ReportError(404, "not_found", "Calibration not found");

  const [monitors, history, shadow] = await Promise.all([
    listDriftMonitors(userId, calibrationId),
    listDriftChecks(userId, calibrationId),
    shadowStats(userId, calibrationId),
  ]);
  const monitor = monitors[0] ?? null;

  const body = buildAuditReport({
    calibration,
    monitor: monitor
      ? {
          id: monitor.id,
          window_days: monitor.window_days,
          active: monitor.active,
          thresholds: monitor.thresholds,
          last_status: monitor.last_status,
          last_checked_at: monitor.last_checked_at,
        }
      : null,
    driftHistory: history,
    shadow,
    issuedAt: new Date(),
    issuer: SITE_URL_CONFIGURED ? SITE_URL : null,
  });
  return signReport(body, key);
}
