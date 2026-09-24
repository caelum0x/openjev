import type { GoldCase } from "./types.ts";
import { DEPARTMENT, IS_REFUND, IS_SPAM, SEVERITY, TONE } from "./schemas.ts";

/**
 * Minimal and empty state. One-word or empty inputs carry almost no signal, so
 * a calibrated engine should be *uncertain*: choice confidence low, noul near
 * 0.5. These assertions are mostly confidence bands (soft) — the suite is
 * checking that the engine does not hallucinate certainty from nothing. A few
 * one-word states do carry a clear label and are gated.
 */
export const MINIMAL: GoldCase[] = [
  {
    id: "min-refund-word",
    source: "minimal: single clear keyword",
    features: ["minimal"],
    state: "refund",
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", min: 0.5 } }],
  },
  {
    id: "min-broken-word",
    source: "minimal: single word bug",
    features: ["minimal"],
    state: "crashed",
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 0.5, max: 2, soft: true } }],
  },
  {
    id: "min-angry-word",
    source: "minimal: single tone word",
    features: ["minimal"],
    state: "furious",
    questions: TONE,
    expect: [{ choice: { id: "tone", value: "angry", minP: 0.35, soft: true } }],
  },
  {
    id: "min-thanks-word",
    source: "minimal: single calm word",
    features: ["minimal"],
    state: "thanks",
    questions: TONE,
    expect: [{ choice: { id: "tone", value: "calm", minP: 0.35 } }],
  },
  {
    id: "min-empty-string",
    source: "empty: no signal at all",
    features: ["empty", "minimal"],
    state: "",
    questions: DEPARTMENT,
    expect: [
      {
        choice: {
          id: "department",
          value: "returns",
          confBand: [0, 0.6],
          soft: true,
        },
      },
    ],
  },
  {
    id: "min-empty-noul",
    source: "empty: noul should sit near 0.5",
    features: ["empty", "minimal"],
    state: "",
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", min: 0.2, max: 0.65, soft: true } }],
  },
  {
    id: "min-whitespace",
    source: "empty: whitespace-only state",
    features: ["empty", "minimal"],
    state: "   ",
    questions: IS_SPAM,
    expect: [{ noul: { id: "is_spam", min: 0.1, max: 0.7, soft: true } }],
  },
  {
    id: "min-punct",
    source: "minimal: punctuation only",
    features: ["minimal", "empty"],
    state: "???",
    questions: TONE,
    expect: [
      {
        choice: {
          id: "tone",
          value: "calm",
          confBand: [0, 0.65],
          soft: true,
        },
      },
    ],
  },
  {
    id: "min-shipping-word",
    source: "minimal: one word routes to shipping",
    features: ["minimal"],
    state: "tracking",
    questions: DEPARTMENT,
    expect: [
      { choice: { id: "department", value: "shipping", minP: 0.3, soft: true } },
    ],
  },
  {
    id: "min-login-word",
    source: "minimal: one word routes to account",
    features: ["minimal"],
    state: "password",
    questions: DEPARTMENT,
    expect: [
      { choice: { id: "department", value: "account", minP: 0.3, soft: true } },
    ],
  },
];
