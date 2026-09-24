import { useMemo, useState } from "react";
import {
  pickThreshold,
  thresholdCurve,
  type CalSample,
  type ThresholdPoint,
} from "@/lib/jev/calibration-fit";

/**
 * Threshold picker: choose a target precision and see the lowest confidence
 * threshold that reaches it, with the coverage it keeps (answered
 * automatically) and the share that would escalate / abstain. Also lets the
 * user drag the threshold directly. Works from raw samples or a stored curve.
 */
type ThresholdPickerProps = {
  samples?: readonly CalSample[];
  curve?: readonly ThresholdPoint[];
  initialTarget?: number;
};

function pct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

export function ThresholdPicker({ samples, curve: given, initialTarget = 0.95 }: ThresholdPickerProps) {
  const curve = useMemo(
    () => (given ? [...given] : thresholdCurve(samples ?? [])),
    [given, samples],
  );
  const [target, setTarget] = useState(initialTarget);
  const recommended = pickThreshold(curve, target);
  const [manual, setManual] = useState<number | null>(null);
  const active =
    manual === null
      ? recommended
      : curve.reduce((best, p) =>
          Math.abs(p.threshold - manual) < Math.abs(best.threshold - manual) ? p : best,
        curve[0]!);
  const total = curve[0]?.answered ?? 0;

  if (total === 0) {
    return <p className="text-sm text-muted">No graded answers to pick a threshold from.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Target precision: {(target * 100).toFixed(0)}%
          </span>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.01}
            value={target}
            onChange={(e) => {
              setTarget(Number(e.target.value));
              setManual(null);
            }}
            className="w-full accent-[var(--color-accent)]"
          />
        </label>
        <label className="space-y-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Or set the threshold: {(manual ?? recommended?.threshold ?? 0).toFixed(2)}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={manual ?? recommended?.threshold ?? 0}
            onChange={(e) => setManual(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
        </label>
      </div>

      {active ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Tile label="Threshold" value={active.threshold.toFixed(2)} />
          <Tile label="Precision" value={pct(active.precision)} />
          <Tile label="Coverage (auto)" value={pct(active.coverage)} />
          <Tile label="Escalated / abstain" value={pct(active.escalated)} />
        </div>
      ) : (
        <p className="text-sm text-danger">
          No threshold reaches {(target * 100).toFixed(0)}% precision on these {total} answers.
          Lower the target, add labels, or fit a calibration.
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted">
        Send <code className="font-mono">escalate_below</code> with the <code className="font-mono">auto</code>{" "}
        model (or <code className="font-mono">abstain_below</code> on any model) set to this threshold:
        answers above it are served locally, the rest go to your LLM or come back as{" "}
        <code className="font-mono">abstained</code>. Based on {total} graded answers.
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-inset px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">{label}</p>
      <p className="mt-1 font-mono text-sm tabular-nums">{value}</p>
    </div>
  );
}
