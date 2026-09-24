import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/jev/browser";
import { engineLabel, type EngineId } from "@/lib/jev/engine-id";
import { ImportError, parseExamples } from "@/lib/jev/label-import";

/** Engine fields every calibration summary carries (see calibrations.server.ts). */
export type CalibrationEngineFields = {
  id: string;
  engine: EngineId | null;
  engine_current: EngineId;
  engine_mismatch: string | null;
  refit_available: boolean;
  refit_unavailable_reason: string | null;
  refit_count: number;
  /** Upload calibrations without stored inputs can be re-fitted from a label file. */
  source?: "upload" | "eval_run";
  fitted_at: number;
};

/** Short engine cell: fitted engine, plus a flag when it is not the serving one. */
export function CalibrationEngineCell({ cal }: { cal: CalibrationEngineFields }) {
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-xs">{cal.engine ? cal.engine.kind : "unrecorded"}</p>
      {cal.engine_mismatch ? (
        <p className="font-mono text-[10px] text-danger">not applied: re-fit</p>
      ) : (
        <p className="font-mono text-[10px] text-subtle">applies</p>
      )}
    </div>
  );
}

/** Explains the engine a map was fitted on vs. the one serving now. */
export function CalibrationEngineNotice({ cal }: { cal: CalibrationEngineFields }) {
  if (!cal.engine_mismatch) {
    return (
      <p className="text-xs text-muted">
        Fitted on the {engineLabel(cal.engine)}, which is the engine serving this model now, so the
        map is applied.
      </p>
    );
  }
  return (
    <p className="rounded-sm bg-inset px-3 py-2 text-xs leading-relaxed text-danger">
      Not applied. This map was fitted on the {engineLabel(cal.engine)}; this deployment now answers
      with the {engineLabel(cal.engine_current)}. Confidences from different engines are not
      comparable, so requests that pass this <code className="font-mono">calibration_id</code> get
      raw confidences and{" "}
      <code className="font-mono">calibration.skipped_reason: "{cal.engine_mismatch}"</code>. Re-fit
      to fix it.
    </p>
  );
}

/**
 * Re-fit a calibration in place on the serving engine. Stored labelled inputs
 * are answered again; the id does not change.
 */
export function RefitButton({
  cal,
  onDone,
  size = "sm",
}: {
  cal: CalibrationEngineFields;
  onDone: () => void | Promise<void>;
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refit(examples?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/calibrations?id=${encodeURIComponent(cal.id)}&action=refit`, {
        method: "POST",
        ...(examples ? { body: JSON.stringify({ examples }) } : {}),
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-fit failed");
    } finally {
      setBusy(false);
    }
  }

  async function refitFromFile(file: File | undefined) {
    if (!file) return;
    let examples;
    try {
      examples = parseExamples(await file.text());
    } catch (err) {
      setError(err instanceof ImportError ? err.message : "Could not read the labelled rows.");
      return;
    }
    await refit(examples);
  }

  if (!cal.refit_available) {
    if (cal.source === "upload") {
      return (
        <div className="max-w-xs space-y-1">
          <p className="text-[11px] leading-snug text-muted">
            Fitted before labelled inputs were stored. Upload the same labels (CSV, JSONL, or JSON)
            to re-fit in place; they are kept so later re-fits need no upload.
          </p>
          <label className="block text-[11px] text-muted">
            <span className="sr-only">Labelled rows for re-fit</span>
            <input
              type="file"
              accept=".csv,.jsonl,.json,text/csv,application/json"
              disabled={busy}
              onChange={(e) => void refitFromFile(e.target.files?.[0])}
              className="text-[11px]"
            />
          </label>
          {busy ? <p className="text-[11px] text-muted">Re-fitting...</p> : null}
          {error ? <p className="text-[11px] text-danger">{error}</p> : null}
        </div>
      );
    }
    return (
      <p className="max-w-xs text-[11px] leading-snug text-muted">
        {cal.refit_unavailable_reason ?? "Re-fit is not available for this calibration."}
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <Button
        type="button"
        size={size}
        variant={cal.engine_mismatch ? "primary" : "secondary"}
        disabled={busy}
        onClick={() => void refit()}
      >
        {busy ? "Re-fitting..." : "Re-fit"}
      </Button>
      {error ? <p className="max-w-xs text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
