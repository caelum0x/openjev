import { Link } from "@tanstack/react-router";
import { useServingEngine } from "@/components/engine-badge";
import {
  ENGINE_ROW_IDS,
  LEADERBOARD_ENCODER,
  LEADERBOARD_GENERATED_AT,
  publicNumbersFor,
  type PublicNumbers,
} from "@/lib/jev/leaderboard-view";
import { cn } from "@/lib/utils";

const pct = (x: number | undefined) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const dec = (x: number | undefined) => (x == null ? "n/a" : x.toFixed(3));

/** Measured public-dataset numbers for one leaderboard row (server-rendered). */
export function PublicNumbersTable({
  numbers,
  active,
}: {
  numbers: PublicNumbers;
  /** Highlight as the engine answering on this deployment. */
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]",
        active ? "ring-1 ring-accent/60" : "",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium tracking-tight text-fg">{numbers.label}</p>
        {active ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
            active on this deployment
          </span>
        ) : null}
      </div>
      {numbers.tracks.length === 0 ? (
        <p className="text-xs text-muted">
          Not measured yet{numbers.notRunReason ? `: ${numbers.notRunReason}` : ""}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              <tr>
                <th className="py-1 pr-4">Dataset</th>
                <th className="py-1 pr-4">n</th>
                <th className="py-1 pr-4">Accuracy</th>
                <th className="py-1 pr-4">ECE</th>
                <th className="py-1 pr-4">Brier</th>
                <th className="py-1 pr-4">OOS AUROC</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs tabular-nums text-muted">
              {numbers.tracks.map((t) => (
                <tr key={t.trackId} className="border-t border-border/60">
                  <td className="py-1.5 pr-4 font-sans text-fg">
                    {t.trackName}
                    <span className="ml-1 text-subtle">
                      ({t.split}, {t.classes} classes)
                    </span>
                  </td>
                  <td className="py-1.5 pr-4">{t.row.n?.toLocaleString("en-US") ?? "n/a"}</td>
                  <td className="py-1.5 pr-4 text-fg">{pct(t.row.accuracy)}</td>
                  <td className="py-1.5 pr-4">{dec(t.row.ece)}</td>
                  <td className="py-1.5 pr-4">{dec(t.row.brier)}</td>
                  <td className="py-1.5 pr-4">{t.row.ood ? t.row.ood.auroc.toFixed(3) : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Provenance() {
  return (
    <p className="text-xs leading-relaxed text-subtle">
      Measured by <span className="font-mono">npm run leaderboard</span> on full public test
      splits ({LEADERBOARD_GENERATED_AT}). Accuracy and ECE are in-scope only; OOS AUROC is the
      out-of-scope detector on CLINC150. Methodology and every backend are on the{" "}
      <Link to="/leaderboard" className="text-fg underline underline-offset-2">
        leaderboard
      </Link>
      .
    </p>
  );
}

/**
 * Which engine serves `system-one` here (live, from /api/v1/status) next to
 * the measured public-dataset numbers of both engines.
 */
export function ActiveEngineNumbers() {
  const local = useServingEngine();
  const embedding = publicNumbersFor(ENGINE_ROW_IDS.embedding);
  const lexical = publicNumbersFor(ENGINE_ROW_IDS.lexical);
  const activeKind = local?.engine ?? null;
  const encoderDiffers =
    activeKind === "embedding" &&
    LEADERBOARD_ENCODER !== null &&
    local?.encoder !== undefined &&
    local.encoder !== LEADERBOARD_ENCODER;

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Active engine for system-one
        </p>
        {local === null ? (
          <p className="mt-1 text-sm text-muted">Checking this deployment...</p>
        ) : local.engine === "embedding" ? (
          <p className="mt-1 text-sm text-fg">
            Embedding engine <span className="font-mono text-muted">({local.encoder})</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-fg">
            Lexical engine (TF-IDF){" "}
            <span className="text-muted">
              · embedding engine not running: {local.reason ?? "model not installed"}. Install it
              with <span className="font-mono">npm run embed-download</span>.
            </span>
          </p>
        )}
        {encoderDiffers ? (
          <p className="mt-2 text-xs text-muted">
            The numbers below were measured with {LEADERBOARD_ENCODER}; this deployment runs{" "}
            {local?.encoder}, which has not been measured.
          </p>
        ) : null}
      </div>
      {embedding ? <PublicNumbersTable numbers={embedding} active={activeKind === "embedding"} /> : null}
      {lexical ? <PublicNumbersTable numbers={lexical} active={activeKind === "lexical"} /> : null}
      <Provenance />
    </div>
  );
}

/** Public-dataset numbers for a model page (non-`system-one` models). */
export function ModelPublicNumbers({ modelId }: { modelId: string }) {
  const numbers = publicNumbersFor(modelId);
  if (!numbers) {
    return (
      <p className="text-sm text-muted">
        This backend is not on the public-dataset{" "}
        <Link to="/leaderboard" className="text-fg underline underline-offset-2">
          leaderboard
        </Link>{" "}
        yet, so there are no measured public numbers for it.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <PublicNumbersTable numbers={numbers} />
      {numbers.tracks.length > 0 ? <Provenance /> : null}
    </div>
  );
}
