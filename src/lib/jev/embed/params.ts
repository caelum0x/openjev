/**
 * Fitted constants of the embedding engine. Regenerate with
 *   node --experimental-strip-types scripts/embed-fit.ts
 * which fits them on HELD-OUT data only (Banking77 train, CLINC150 validation,
 * and half of the gold suite) and never on the leaderboard's test splits.
 */
export type EmbedParams = {
  /** Encoder these constants were fitted for. */
  model: string;
  choice: {
    /** Base inverse temperature on similarity gaps. */
    scale: number;
    /** Reference spread of per-question similarities. */
    spreadRef: number;
    /** 0 = one global temperature; 1 = fully spread-normalized per question. */
    spreadAdapt: number;
    /** Weight of the lexical engine's log-probabilities in the logits. */
    lexWeight: number;
  };
  /** Few-shot kNN mixing when options carry `examples`. */
  exampleWeight: number;
  knnK: number;
  noul: { bias: number; simWeight: number; lexWeight: number; noBaseline: number };
  ood: {
    bias: number;
    weights: Partial<
      Record<"maxSim" | "domainSim" | "maha" | "energy" | "logK" | "logLen" | "maxSimK", number>
    >;
    energyTemp: number;
    shrink: number;
    minVar: number;
  };
  /** Where the constants came from (reported on the leaderboard). */
  fitted_on: string;
};

export const EMBED_PARAMS: EmbedParams = {
  model: "gte-small",
  choice: {
    scale: 65,
    spreadRef: 0.03,
    spreadAdapt: 0.5,
    lexWeight: 0.1,
  },
  exampleWeight: 0.6,
  knnK: 3,
  noul: {
    bias: 0.25,
    simWeight: 0,
    lexWeight: 0.75,
    noBaseline: 0.7,
  },
  ood: {
    bias: 91.833975,
    weights: {
      maxSim: -34.955472,
      domainSim: -23.561846,
      maha: -8.581388,
      energy: -39.763054,
      logK: 0.659395,
      logLen: -1.190045,
      maxSimK: -0.864309,
    },
    energyTemp: 0.02,
    shrink: 8,
    minVar: 0.0001,
  },
  fitted_on:
    "Banking77 train, CLINC150 validation and the even half of the gold suite (choice/score temperature and lexical blend); CLINC150 validation (out-of-scope detector; operating point = 5% of held-out in-scope questions); even half of the gold suite (noul). No leaderboard test split was used.",
};

/** FNV-1a 32-bit hash, hex. Deterministic and isomorphic (no node:crypto). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Fingerprint of the fitted constants. Any refit of EMBED_PARAMS changes it, so
 * a calibration map fitted on the old constants is detected as stale.
 */
export const EMBED_PARAMS_FINGERPRINT = fnv1a(JSON.stringify(EMBED_PARAMS));

/** Version string of the embedding engine: encoder id + constants fingerprint. */
export function embedEngineVersion(encoder: string): string {
  return `${encoder}+p${EMBED_PARAMS_FINGERPRINT}`;
}
