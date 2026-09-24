import type { Questions, State } from "../types.ts";

/**
 * The feature axes the suite is designed to exercise. Every case tags the axes
 * it stresses so the coverage report can prove the suite actually covers
 * adversarial paraphrases, negation, domain shift, ambiguity, minimal/long-form
 * state, structured input, and multilingual input, rather than just asserting it.
 */
export type Feature =
  | "showcase"
  | "paraphrase"
  | "negation"
  | "domain-shift"
  | "ambiguous"
  | "minimal"
  | "empty"
  | "longform"
  | "structured"
  | "multilingual";

export const ALL_FEATURES: readonly Feature[] = [
  "showcase",
  "paraphrase",
  "negation",
  "domain-shift",
  "ambiguous",
  "minimal",
  "empty",
  "longform",
  "structured",
  "multilingual",
];

/**
 * A single expectation against one answer in a case.
 *
 * `soft` marks a *tracking* expectation: it is scored for calibration/coverage
 * but excluded from the pass/fail regression gate. Genuinely hard cases
 * (ambiguous-between-two-valid, adversarial paraphrase the bag-of-words engine
 * is expected to miss) are marked soft so the shipped `gold` script stays a
 * meaningful regression gate while the calibration harness still learns from
 * the miss. `confBand`, when set, asserts the predicted confidence sits inside
 * `[lo, hi]` — the "expected-confidence band" the product promises.
 */
export type GoldExpect = {
  choice?: {
    id: string;
    value: string;
    minP?: number;
    confBand?: [number, number];
    soft?: boolean;
  };
  noul?: {
    id: string;
    min?: number;
    max?: number;
    soft?: boolean;
  };
  score?: {
    id: string;
    min: number;
    max: number;
    soft?: boolean;
  };
};

export type GoldCase = {
  id: string;
  source: string;
  features: Feature[];
  state: State;
  questions: Questions;
  expect: GoldExpect[];
};
