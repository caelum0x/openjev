import type { Answer } from "@/lib/jev/types";
import { legendLabel } from "@/lib/jev/types";
import { cn } from "@/lib/utils";

export function TypePill({ type }: { type: "choice" | "score" | "noul" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2 font-mono text-xs uppercase tracking-wide",
        type === "choice" && "bg-choice/15 text-choice",
        type === "score" && "bg-score/15 text-score",
        type === "noul" && "bg-noul/15 text-noul",
      )}
    >
      {type}
    </span>
  );
}

export function AnswerView({ answer }: { answer: Answer }) {
  if (answer.type === "noul") {
    return (
      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <p className="font-mono text-3xl tabular-nums leading-none tracking-tight">
            {answer.noul.toFixed(2)}
          </p>
          <p className="text-xs text-muted">
            {answer.noul >= 0.85
              ? "act"
              : answer.noul <= 0.15
                ? "act (no)"
                : answer.noul >= 0.5
                  ? "lean yes — check confidence"
                  : "lean no — escalate if irreversible"}
          </p>
        </div>
        <Meter value={answer.noul} tone="noul" />
        <div className="flex justify-between font-mono text-xs text-subtle">
          <span>no 0</span>
          <span>yes 1</span>
        </div>
      </div>
    );
  }

  if (answer.type === "choice") {
    const rows = Object.entries(answer.probabilities).sort(
      (a, b) => b[1] - a[1],
    );
    return (
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-lg tracking-tight">{answer.choice}</p>
          <p className="font-mono text-xs tabular-nums text-muted">
            conf {answer.confidence.toFixed(2)}
          </p>
        </div>
        <div className="space-y-2">
          {rows.map(([k, v]) => (
            <Bar
              key={k}
              label={k}
              value={v}
              active={k === answer.choice}
              tone="choice"
            />
          ))}
        </div>
      </div>
    );
  }

  const rows = Object.entries(answer.probabilities).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-lg tabular-nums tracking-tight">
          {answer.score.toFixed(2)}
          <span className="ml-2 text-xs text-subtle">
            / {rows.length - 1}
          </span>
        </p>
        <p className="font-mono text-xs tabular-nums text-muted">
          conf {answer.confidence.toFixed(2)}
        </p>
      </div>
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <Bar
            key={k}
            label={`${k}  ${legendLabel(answer.legend[k] ?? "")}`}
            value={v}
            active={Math.round(answer.score) === Number(k)}
            tone="score"
          />
        ))}
      </div>
    </div>
  );
}

function Meter({ value, tone }: { value: number; tone: "noul" | "choice" | "score" }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-raised">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          tone === "noul" && "bg-noul",
          tone === "choice" && "bg-choice",
          tone === "score" && "bg-score",
        )}
        style={{ width: `${Math.round(value * 1000) / 10}%` }}
      />
    </div>
  );
}

function Bar({
  label,
  value,
  active,
  tone,
}: {
  label: string;
  value: number;
  active: boolean;
  tone: "choice" | "score";
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "truncate font-mono text-xs",
            active ? "text-fg" : "text-muted",
          )}
        >
          {label}
        </span>
        <span className="font-mono text-xs tabular-nums text-subtle">
          {value.toFixed(2)}
        </span>
      </div>
      <Meter value={value} tone={tone} />
    </div>
  );
}
