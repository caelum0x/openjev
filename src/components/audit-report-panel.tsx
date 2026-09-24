import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { getActiveKey } from "@/lib/jev/browser";

interface AuditReportPanelProps {
  calibrationId: string;
}

type Format = "html" | "json";

type Failure = { message: string; planRequired: boolean };

async function fetchReport(calibrationId: string, format: Format): Promise<Blob> {
  const headers = new Headers();
  const key = getActiveKey();
  if (key) headers.set("Authorization", `Bearer ${key}`);
  const res = await fetch(`/api/v1/reports/${encodeURIComponent(calibrationId)}?format=${format}`, {
    headers,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { type?: string; message?: string };
    } | null;
    const err = new Error(body?.error?.message ?? `Report failed (${res.status})`);
    (err as Error & { planRequired?: boolean }).planRequired =
      body?.error?.type === "plan_required";
    throw err;
  }
  return res.blob();
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * "Download audit report" for one calibration: a signed, printable HTML report
 * (print it to PDF from the browser) and the signed JSON a reviewer can verify
 * with POST /v1/reports/verify.
 */
export function AuditReportPanel({ calibrationId }: AuditReportPanelProps) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function download(format: Format) {
    setBusy(format);
    setFailure(null);
    try {
      const blob = await fetchReport(calibrationId, format);
      saveBlob(blob, `openjev-audit-${calibrationId}.${format}`);
    } catch (err) {
      setFailure({
        message: err instanceof Error ? err.message : "Report failed",
        planRequired: Boolean((err as { planRequired?: boolean }).planRequired),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Audit report</h2>
        <p className="text-xs text-muted">
          One document for your risk team: the fitted map per question, raw and calibrated accuracy,
          ECE and Brier, the recommended threshold, drift history and shadow agreement, and the
          report's own limitations. It is signed (HMAC-SHA256), so a reviewer can check it was not
          edited by sending the JSON to <code className="font-mono">POST /v1/reports/verify</code>.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy !== null} onClick={() => void download("html")}>
          {busy === "html" ? "Preparing..." : "Download audit report"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void download("json")}
        >
          {busy === "json" ? "Preparing..." : "Signed JSON"}
        </Button>
      </div>
      <p className="text-xs text-subtle">Open the HTML file and print it to get a PDF.</p>
      {failure ? (
        <p className="text-sm text-danger">
          {failure.message}{" "}
          {failure.planRequired ? (
            <Link to="/pricing" className="underline">
              See plans
            </Link>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
