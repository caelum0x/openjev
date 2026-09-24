import { MODEL_CARDS, type ModelAvailability } from "@/lib/jev/models";
import { cn } from "@/lib/utils";

/** Availability keyed by model id, as fetched from GET /api/v1/status. */
export type AvailabilityMap = Record<string, ModelAvailability>;

export function ModelPills({
  value,
  onChange,
  includeEscalation = false,
  availability,
}: {
  value: string;
  onChange: (id: string) => void;
  /** Also list non-playground models (the opt-in hosted-LLM escalation tier). */
  includeEscalation?: boolean;
  /**
   * Per-model availability. When provided, models that cannot be served on this
   * deployment (e.g. a Laya sidecar that is not installed) render disabled with
   * an install hint instead of being silently selectable.
   */
  availability?: AvailabilityMap;
}) {
  const cards = MODEL_CARDS.filter((m) => includeEscalation || m.playground);
  return (
    <div className="flex flex-wrap gap-1.5">
      {cards.map((m) => {
        const status = availability?.[m.id];
        // Undefined status = not yet loaded → treat as available (never block
        // the default local models on a slow/absent status fetch).
        const unavailable = status ? !status.available : false;
        const active = value === m.id;
        const hint = status?.install ?? "Requires a separate install.";
        return (
          <button
            key={m.id}
            type="button"
            disabled={unavailable}
            aria-disabled={unavailable}
            title={unavailable ? hint : undefined}
            onClick={() => {
              if (!unavailable) onChange(m.id);
            }}
            className={cn(
              "flex h-11 items-center gap-1.5 rounded-sm px-3 font-mono text-xs transition-colors duration-150",
              unavailable
                ? "cursor-not-allowed bg-raised text-subtle opacity-60"
                : active
                  ? "bg-accent text-accent-fg"
                  : "bg-raised text-muted hover:text-fg",
            )}
          >
            {m.label}
            {unavailable ? (
              <span className="rounded-sm bg-inset px-1 py-0.5 text-[9px] uppercase tracking-[0.08em] text-subtle">
                install
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
