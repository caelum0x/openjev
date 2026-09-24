/**
 * PROOF LINKS — in-app pages that back up a claim made on a marketing page.
 *
 * Comparison and guide pages link here instead of asserting numbers in copy:
 * the leaderboard is re-runnable, calibrations are fitted on your own labels,
 * and shadow mode measures agreement on your own traffic.
 */

export type ProofPath =
  "/leaderboard" | "/calibrations" | "/shadow" | "/self-hosting" | "/pricing" | "/security";

export interface ProofLink {
  readonly to: ProofPath;
  readonly label: string;
}

export const LEADERBOARD_LINK: ProofLink = {
  to: "/leaderboard",
  label: "Re-runnable leaderboard",
};

export const CALIBRATIONS_LINK: ProofLink = {
  to: "/calibrations",
  label: "Fit a calibration on your labels",
};

export const SHADOW_LINK: ProofLink = {
  to: "/shadow",
  label: "Shadow mode against your current model",
};

export const SELF_HOST_LINK: ProofLink = {
  to: "/self-hosting",
  label: "Self-hosting guide",
};
