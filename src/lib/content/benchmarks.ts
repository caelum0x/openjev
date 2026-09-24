/**
 * BENCHMARKS — typed benchmark dataset for /benchmarks.
 *
 * Every number here is read from src/lib/content/latency-bench.json, written
 * by `npm run bench:latency` (scripts/bench-latency.mjs). Only engines that
 * were actually measured appear: the embedding engine (default when its model
 * is installed) and the lexical engine (fallback). Sidecar backends
 * (laya-mlx, laya-onnx, otsone-1), the native engine and LLM backends are not
 * in these tables because they have not been measured with this harness.
 *
 * Data only — no JSX.
 */
import BENCH from "@/lib/content/latency-bench.json";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BenchmarkColumn = "embedding" | "lexical";

export interface BenchmarkRow {
  /** Short slug used as a row key. */
  readonly id: string;
  /** Human-readable metric name shown in the table. */
  readonly metric: string;
  /** Unit label appended to numbers, e.g. "ms", "%". */
  readonly unit: string;
  /** Per-engine values; a string when the engine was not measured. */
  readonly values: Record<BenchmarkColumn, number | string>;
  /** If true, lower is better (latency). False = higher is better. */
  readonly lowerIsBetter: boolean;
}

export interface BenchmarkScenario {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly inputShape: string;
  readonly rows: readonly BenchmarkRow[];
}

export interface BenchmarkFAQ {
  readonly q: string;
  readonly a: string;
}

type EngineResult = {
  p50_ms: number;
  p95_ms: number;
  mean_ms: number;
  max_ms: number;
  determinism_pct: number;
};

type BenchFile = {
  measured_at: string;
  machine: {
    cpu: string;
    cores: number;
    memory_gb: number;
    os: string;
    node: string;
    load_avg_1m_at_start?: number;
  };
  method: {
    scope: string;
    iterations: number;
    warmup: number;
    concurrency: number;
    distinct_states: boolean;
    determinism_runs: number;
    command: string;
  };
  engines: { id: string; label: string; available: boolean; reason: string | null }[];
  scenarios: {
    id: string;
    title: string;
    inputShape: string;
    results: Record<string, EngineResult | null>;
  }[];
};

const DATA = BENCH as BenchFile;

/** The measurement this page (and the latency copy elsewhere) is built from. */
export const LATENCY_BENCH = DATA;

// ─── Column display metadata ─────────────────────────────────────────────────

const COLUMN_IDS: readonly BenchmarkColumn[] = ["embedding", "lexical"];

export const BENCHMARK_COLS: readonly {
  readonly id: BenchmarkColumn;
  readonly label: string;
  readonly note: string;
}[] = COLUMN_IDS.map((id) => {
  const e = DATA.engines.find((x) => x.id === id);
  return {
    id,
    label: e?.label ?? id,
    note:
      id === "embedding"
        ? "default engine when the embedding model is installed"
        : "fallback engine, no model download",
  };
});

// ─── Scenarios ───────────────────────────────────────────────────────────────

const DESCRIPTIONS: Record<string, string> = {
  "ticket-routing":
    "Classify a free-text support message into one of four departments (returns / shipping / billing / general). Single Choice question.",
  "log-triage":
    "Classify a structured JSON log event (service, level, message, duration_ms) into allow / review / block. Single Choice question.",
  "multi-question":
    "Ten independent questions (3 Choice, 4 Noul, 3 Score) over one free-text state in a single call.",
};

function cell(r: EngineResult | null | undefined, pick: (r: EngineResult) => number): number | string {
  return r ? pick(r) : "not measured";
}

function row(
  id: string,
  metric: string,
  unit: string,
  lowerIsBetter: boolean,
  results: Record<string, EngineResult | null>,
  pick: (r: EngineResult) => number,
): BenchmarkRow {
  return {
    id,
    metric,
    unit,
    lowerIsBetter,
    values: {
      embedding: cell(results.embedding, pick),
      lexical: cell(results.lexical, pick),
    },
  };
}

export const BENCHMARK_SCENARIOS: readonly BenchmarkScenario[] = DATA.scenarios.map((s) => ({
  id: s.id,
  title: s.title,
  description: DESCRIPTIONS[s.id] ?? s.title,
  inputShape: s.inputShape,
  rows: [
    row("p50-latency", "p50 latency per request", "ms", true, s.results, (r) => r.p50_ms),
    row("p95-latency", "p95 latency per request", "ms", true, s.results, (r) => r.p95_ms),
    row("mean-latency", "mean latency per request", "ms", true, s.results, (r) => r.mean_ms),
    row(
      "determinism",
      `identical answers (${DATA.method.determinism_runs} repeat runs)`,
      "%",
      false,
      s.results,
      (r) => r.determinism_pct,
    ),
  ],
}));

/** p50/p95 for one scenario + engine, for copy that quotes a figure. */
export function measuredLatency(
  scenarioId: string,
  engine: BenchmarkColumn,
): { p50: number; p95: number } | null {
  const r = DATA.scenarios.find((s) => s.id === scenarioId)?.results[engine];
  return r ? { p50: r.p50_ms, p95: r.p95_ms } : null;
}

// ─── Methodology ─────────────────────────────────────────────────────────────

const m = DATA.machine;
const loadNote =
  m.load_avg_1m_at_start !== undefined
    ? ` The 1-minute load average when the run started was ${m.load_avg_1m_at_start} (the machine was not idle), so tail latencies are on the pessimistic side.`
    : "";

export const METHODOLOGY = `
Measured ${DATA.measured_at} with \`${DATA.method.command}\` (scripts/bench-latency.mjs).

What is timed: ${DATA.method.scope}. A hosted or remote call adds its own network round-trip, TLS and
HTTP overhead on top of these numbers.

Procedure: ${DATA.method.warmup} warm-up requests per engine and scenario (not recorded; loads the ONNX session
and caches option prototypes), then ${DATA.method.iterations} measured requests per cell, one at a time, with scenarios and engines interleaved
so background load is shared across cells. Every measured
request uses a distinct state, so the embedding engine never answers the state from its cache.
Percentiles are nearest-rank over the ${DATA.method.iterations} samples.

Determinism: the same fixed request is repeated ${DATA.method.determinism_runs} times; the figure is the share of runs
whose answers are byte-identical to the first.

Machine: ${m.cpu}, ${m.cores} cores, ${m.memory_gb} GB RAM, ${m.os}, Node.js ${m.node}.${loadNote}

Not measured here: laya-mlx, laya-onnx and otsone-1 (they run in a sidecar process), the native engine,
and LLM backends. They have no latency figures on this site until they are measured the same way.

Accuracy and calibration are not in these tables. Measured accuracy, ECE and Brier on public
datasets (Banking77, CLINC150 + out-of-scope, AG News) are on the public-dataset leaderboard at
/leaderboard, reproducible with \`npm run leaderboard\`.
`.trim();

// ─── FAQs ────────────────────────────────────────────────────────────────────

export const BENCHMARK_FAQS: readonly BenchmarkFAQ[] = [
  {
    q: "Where do these numbers come from?",
    a: `From one run of \`${DATA.method.command}\` on ${DATA.measured_at} (${m.cpu}, ${m.cores} cores). The script and its output (src/lib/content/latency-bench.json) are in the repository, so you can re-run it on your own hardware.`,
  },
  {
    q: "Do the figures include the network?",
    a: "No. They are engine time per request inside the server process. A call over the internet adds its own round-trip; a call to an engine on the same host or in the same private network adds much less. Measure end-to-end from your own client before setting a timeout budget.",
  },
  {
    q: "Why is the embedding engine slower than the lexical engine?",
    a: "The embedding engine runs a small ONNX sentence encoder over the state for every question, then compares it with cached option prototypes. The lexical engine only tokenises and scores terms. The embedding engine is the default because it is markedly more accurate on free text; see /leaderboard for the measured gap.",
  },
  {
    q: "Why are there no laya-mlx, laya-onnx, native or LLM columns?",
    a: "Because we have not measured them with this harness yet. Earlier versions of this page showed estimated figures for those backends; they were removed rather than presented as measurements.",
  },
  {
    q: "What does 'identical answers' mean?",
    a: "The same request is repeated and every run's answers (choice, probabilities, confidence) are compared byte-for-byte with the first. Both local engines have no random state, so the expected value is 100%.",
  },
];

// ─── Measured figures for copy elsewhere ─────────────────────────────────────

function fmtMs(n: number): string {
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

function phrase(scenarioId: string, engine: BenchmarkColumn): string {
  const r = measuredLatency(scenarioId, engine);
  return r ? `p50 ${fmtMs(r.p50)} ms, p95 ${fmtMs(r.p95)} ms` : "not measured";
}

/**
 * Measured latency strings for copy on other pages, so every figure quoted on
 * the site comes from latency-bench.json. Engine time per request, in-process.
 */
export const MEASURED_LATENCY = {
  date: DATA.measured_at,
  machine: DATA.machine.cpu,
  /** Embedding engine, one Choice question. */
  embedding1: phrase("ticket-routing", "embedding"),
  /** Lexical engine, one Choice question. */
  lexical1: phrase("ticket-routing", "lexical"),
  /** Embedding engine, ten questions over one state. */
  embedding10: phrase("multi-question", "embedding"),
  /** Lexical engine, ten questions over one state. */
  lexical10: phrase("multi-question", "lexical"),
  /** Short source note to append after a figure. */
  source: `engine time on ${DATA.machine.cpu}, measured ${DATA.measured_at}; see /benchmarks`,
  notMeasured: "not measured yet (see /benchmarks)",
} as const;
