/**
 * Reliability diagram: for each confidence band, the model's mean confidence
 * (x) against its observed accuracy (bar height). A perfectly calibrated model
 * has every bar touching the diagonal. Pure SVG, no chart dependency.
 */
export type ReliabilityBinView = {
  lo: number;
  hi: number;
  count: number;
  accuracy: number | null;
  avgConfidence: number | null;
};

type ReliabilityChartProps = {
  bins: readonly ReliabilityBinView[];
  title?: string;
  height?: number;
};

const W = 320;
const PAD = 28;

export function ReliabilityChart({ bins, title, height = 220 }: ReliabilityChartProps) {
  const H = height;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const x = (v: number) => PAD + v * plotW;
  const y = (v: number) => H - PAD - v * plotH;
  const nonEmpty = bins.filter((b) => b.count > 0);
  return (
    <figure className="space-y-2">
      {title ? (
        <figcaption className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          {title}
        </figcaption>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[420px]"
        role="img"
        aria-label={`Reliability diagram over ${nonEmpty.length} confidence bands`}
      >
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(0)} stroke="var(--color-border)" />
        <line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(1)} stroke="var(--color-border)" />
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(1)}
          y2={y(1)}
          stroke="var(--color-subtle)"
          strokeDasharray="4 4"
        />
        {bins.map((b) =>
          b.count > 0 && b.accuracy !== null ? (
            <g key={`${b.lo}-${b.hi}`}>
              <rect
                x={x(b.lo) + 1}
                y={y(b.accuracy)}
                width={Math.max(1, x(b.hi) - x(b.lo) - 2)}
                height={Math.max(0, y(0) - y(b.accuracy))}
                fill="var(--color-accent)"
                fillOpacity={0.55}
              >
                <title>
                  {`confidence ${b.lo.toFixed(2)}-${b.hi.toFixed(2)}: accuracy ${(b.accuracy * 100).toFixed(0)}% over ${b.count}`}
                </title>
              </rect>
              {b.avgConfidence !== null ? (
                <circle cx={x(b.avgConfidence)} cy={y(b.avgConfidence)} r={2.5} fill="var(--color-fg)" />
              ) : null}
            </g>
          ) : null,
        )}
        <text x={x(0.5)} y={H - 6} textAnchor="middle" className="fill-[var(--color-subtle)] text-[9px]">
          confidence
        </text>
        <text
          x={10}
          y={y(0.5)}
          textAnchor="middle"
          transform={`rotate(-90 10 ${y(0.5)})`}
          className="fill-[var(--color-subtle)] text-[9px]"
        >
          accuracy
        </text>
      </svg>
    </figure>
  );
}
