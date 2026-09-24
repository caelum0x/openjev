/**
 * Read-only view over the committed leaderboard results
 * (src/lib/content/leaderboard.json) for pages that quote measured numbers:
 * /status and the model pages. Numbers are never computed here; they are the
 * ones `npm run leaderboard` measured on full public test splits.
 */
import LEADERBOARD from "@/lib/content/leaderboard.json";
import type { LeaderboardFile, PublicTrackRow } from "./leaderboard";

const FILE = LEADERBOARD as unknown as LeaderboardFile;

/** Leaderboard row ids for the two engines behind `system-one`. */
export const ENGINE_ROW_IDS = { embedding: "system-one", lexical: "system-one-lexical" } as const;

export type TrackNumbers = {
  trackId: string;
  trackName: string;
  split: string;
  classes: number;
  row: PublicTrackRow;
};

export type PublicNumbers = {
  rowId: string;
  label: string;
  /** Tracks this backend was scored on (status "ok"). */
  tracks: TrackNumbers[];
  /** Why it has no public numbers, when it was not run anywhere. */
  notRunReason: string | null;
};

export const LEADERBOARD_GENERATED_AT = FILE.generated_at;

/** Encoder the embedding-engine rows were measured with, or null. */
export const LEADERBOARD_ENCODER: string | null =
  FILE.embedding_engine && "encoder" in FILE.embedding_engine ? FILE.embedding_engine.encoder : null;

/** Public-dataset numbers for one leaderboard row id, or null when it is not on the board. */
export function publicNumbersFor(rowId: string): PublicNumbers | null {
  const tracks = FILE.public_tracks ?? [];
  let label: string | null = null;
  let notRunReason: string | null = null;
  const scored: TrackNumbers[] = [];
  for (const t of tracks) {
    const row = t.rows.find((r) => r.id === rowId);
    if (!row) continue;
    label ??= row.label;
    if (row.status === "ok") {
      scored.push({ trackId: t.id, trackName: t.name, split: t.split, classes: t.classes, row });
    } else {
      notRunReason ??= row.reason ?? "not run";
    }
  }
  if (label === null) return null;
  return { rowId, label, tracks: scored, notRunReason: scored.length ? null : notRunReason };
}
