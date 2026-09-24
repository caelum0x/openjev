/**
 * ROADMAP — content behind /roadmap.
 *
 * Grouped by status: shipped → in-progress → planned → considering.
 * All items reflect what is actually present (or known to be absent) in the
 * codebase: the three primitives, calibration harness, backends, SDK, console
 * surfaces, and forthcoming platform work.
 *
 * Data only — no JSX.
 */

export type RoadmapStatus = "shipped" | "in-progress" | "planned" | "considering";

export interface RoadmapItem {
  /** Stable internal id. */
  readonly id: string;
  /** Short headline. */
  readonly title: string;
  /** One or two sentences describing the item. */
  readonly description: string;
  /** Domain tags for visual grouping within a status block. */
  readonly tags: readonly string[];
}

export interface RoadmapGroup {
  readonly status: RoadmapStatus;
  /** Display label in the UI. */
  readonly label: string;
  /** One-line context line shown above the items. */
  readonly summary: string;
  readonly items: readonly RoadmapItem[];
}

export const ROADMAP_GROUPS: readonly RoadmapGroup[] = [
  // ── Shipped ────────────────────────────────────────────────────────────────
  {
    status: "shipped",
    label: "Shipped",
    summary: "In the current open-source release and on the hosted endpoint.",
    items: [
      {
        id: "primitives",
        title: "Choice, Score, and Noul primitives",
        description:
          "The three typed decision primitives: Choice for closed-set classification, Score for ordered rubric levels, and Noul for calibrated yes/no probabilities. Each returns the winning value, a full probability distribution, and a calibrated confidence.",
        tags: ["engine", "primitives"],
      },
      {
        id: "systemone-endpoint",
        title: "POST /api/v1/systemone",
        description:
          "Single HTTP endpoint that accepts a shared state and a map of typed questions, evaluates every question against the state, and returns typed answers under the same keys. One call handles a full checklist.",
        tags: ["api"],
      },
      {
        id: "calibrated-confidence",
        title: "Calibrated confidence and full distributions",
        description:
          "Every decision ships a confidence scalar and the full probability distribution. Its calibration (whether a 0.8 is right roughly 80% of the time) is measured with ECE on the public-dataset leaderboard and can be fitted to your own labels, which is what makes thresholding meaningful.",
        tags: ["calibration", "engine"],
      },
      {
        id: "backends",
        title: "Five interchangeable backends",
        description:
          "laya-mlx (Apple-silicon via MLX), laya-onnx (portable ONNX, the CPU-production default), native scorer (zero model download, fully deterministic), local (point at a server you already run), and any-LLM (wrap a hosted chat model). The request shape never changes.",
        tags: ["backends"],
      },
      {
        id: "tuning-profiles",
        title: "Four engine tuning profiles",
        description:
          "system-one (balanced default), jev-v13 (sharper top-mass), decisive (high-confidence bias), and contrastive (separation-focused). Each is a set of engine scalar weights evaluated against the gold suite; no separate training run.",
        tags: ["engine"],
      },
      {
        id: "gold-suite",
        title: "93-case gold eval suite",
        description:
          "A labelled test suite that covers all three question types and multiple domain feature axes. Used to measure calibration (ECE, MCE, Brier) and accuracy for every tuning profile.",
        tags: ["calibration", "evals"],
      },
      {
        id: "calibration-harness",
        title: "Calibration harness: ECE, MCE, Brier",
        description:
          "Pure, dependency-free calibration utilities that bin predictions by confidence and compute Expected Calibration Error, Maximum Calibration Error, and Brier score. Runs against any backend's predictions.",
        tags: ["calibration"],
      },
      {
        id: "typescript-sdk",
        title: "@caelum/typesafe TypeScript SDK",
        description:
          "The official TypeScript client with typed helpers for choice(), score(), and noul(). Works in Node, Deno, edge runtimes, and browsers. The request format is also plain HTTP, so any language can call the endpoint without the SDK.",
        tags: ["sdk"],
      },
      {
        id: "docker",
        title: "Self-hosting via Docker",
        description:
          "The openjev/engine Docker image lets you run the full System One endpoint inside your own infrastructure. No data leaves your boundary and there is no per-call token bill.",
        tags: ["self-hosting"],
      },
      {
        id: "console",
        title: "Console: playground, dashboard, logs, and API keys",
        description:
          "Browser-based console with a live playground (no key required), a usage dashboard, a decision log, and API key management for the hosted endpoint.",
        tags: ["console"],
      },
      {
        id: "skill-md",
        title: "Agent SKILL.md for AI tool-calling",
        description:
          "A bundled SKILL.md that AI agents can install to call System One as a native tool. The agent reads the skill, sends typed questions, and gets back values it can branch on without prompt-engineering its own parser.",
        tags: ["agents"],
      },
      {
        id: "quota",
        title: "Per-key quota enforcement and usage metering",
        description:
          "Built-in rate limiting and monthly quota tracking per API key. Self-hosted instances run with no enforcement; hosted keys enforce a free-tier floor and pay-tier allowances via Railyard.",
        tags: ["platform"],
      },
      {
        id: "typesafe-compat",
        title: "System One v1 wire protocol compatibility",
        description:
          "The payload format is wire-compatible with the upstream System One v1 API. A payload written for the open-source engine runs unchanged against any compatible hosted endpoint and back — the switch is a URL change.",
        tags: ["api", "compatibility"],
      },
    ],
  },

  // ── In progress ───────────────────────────────────────────────────────────
  {
    status: "in-progress",
    label: "In progress",
    summary: "Being built now; expected in the next release cycle.",
    items: [
      {
        id: "calibration-dashboard",
        title: "Calibration dashboard in the console",
        description:
          "A reliability diagram (empirical accuracy vs. model confidence per bucket), ECE trend over time, and per-question-type breakdown. Lets you see at a glance whether the confidence numbers you are thresholding on are still honest.",
        tags: ["console", "calibration"],
      },
      {
        id: "coverage-report",
        title: "Coverage report for the eval suite",
        description:
          "Surface which feature axes and question types are under-exercised in your project's gold suite, with a visual gap map. Guides you toward the test cases that would most improve calibration confidence.",
        tags: ["evals", "calibration"],
      },
      {
        id: "python-sdk",
        title: "Python client SDK",
        description:
          "An official OpenJev client for Python with typed dataclass output, async support, and parity with the TypeScript SDK's choice/score/noul helpers.",
        tags: ["sdk"],
      },
    ],
  },

  // ── Planned ───────────────────────────────────────────────────────────────
  {
    status: "planned",
    label: "Planned",
    summary: "On the near-term roadmap; designs are underway.",
    items: [
      {
        id: "go-sdk",
        title: "Go client SDK",
        description:
          "Official Go SDK with idiomatic struct types, context cancellation, and the same choice/score/noul request builders as the TypeScript client.",
        tags: ["sdk"],
      },
      {
        id: "batch-endpoint",
        title: "Batch endpoint: many states, one call",
        description:
          "A POST /api/v1/systemone/batch that evaluates a list of state + questions pairs in one HTTP call. Designed for data-team backfills and labelling pipelines where each row is an independent classification job.",
        tags: ["api"],
      },
      {
        id: "webhooks",
        title: "Webhook delivery for completed decisions",
        description:
          "Push decision results to a URL you configure, with signed payloads and retry semantics. Useful for async pipelines that queue decisions and process results out-of-band.",
        tags: ["platform"],
      },
      {
        id: "decision-export",
        title: "Decision export (JSONL / CSV)",
        description:
          "Export all decisions for a project in JSONL or CSV from the console. Includes the state, questions, answers, confidence, and timestamp for every call — a full audit trail and a ready-made dataset for calibration analysis.",
        tags: ["console", "platform"],
      },
      {
        id: "finetuning-docs",
        title: "Fine-tuning documentation",
        description:
          "A complete guide to adapting the engine to a domain-specific distribution: how to build a domain gold suite, evaluate baseline calibration, and adjust tuning profile scalars for better ECE on your data.",
        tags: ["docs", "calibration"],
      },
    ],
  },

  // ── Considering ───────────────────────────────────────────────────────────
  {
    status: "considering",
    label: "Considering",
    summary: "Under evaluation; no timeline commitment yet.",
    items: [
      {
        id: "streaming",
        title: "Streaming partial decisions",
        description:
          "Surface incremental confidence updates as the engine refines its distribution, so a UI can show a live probability bar before the final answer is committed. Requires a streaming-capable runtime on the backend.",
        tags: ["api", "engine"],
      },
      {
        id: "otel",
        title: "OpenTelemetry trace export",
        description:
          "Emit spans for each decision call, including backend selection, question count, latency, and confidence. Lets you trace decision paths through a distributed system alongside your existing observability stack.",
        tags: ["platform"],
      },
      {
        id: "mcp-server",
        title: "MCP server mode",
        description:
          "Serve typed decisions over the Model Context Protocol so any MCP-aware agent can call choice(), score(), and noul() as native tools without a custom skill file.",
        tags: ["agents", "api"],
      },
      {
        id: "hosted-jev",
        title: "OpenJev Cloud hosted endpoint",
        description:
          "A fully managed OpenJev Cloud endpoint wire-compatible with the System One v1 API, with SLA, usage-based billing, and no infrastructure to run. The same payload and SDK as the open-source engine.",
        tags: ["platform"],
      },
    ],
  },
];

/** All items flat, for sitemap or search. */
export const ROADMAP_ITEMS: readonly RoadmapItem[] = ROADMAP_GROUPS.flatMap(
  (g) => g.items,
);
