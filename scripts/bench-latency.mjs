#!/usr/bin/env node
/**
 * Latency benchmark for the two engines that run in-process with no sidecar:
 * the sentence-embedding engine (default when its model is installed) and the
 * lexical engine (fallback). Writes src/lib/content/latency-bench.json, which
 * /benchmarks renders and the backend/solution copy quotes.
 *
 *   npm run bench:latency
 *   BENCH_ITERATIONS=500 npm run bench:latency
 *
 * Method (also written into the JSON so the page can show it):
 *  - Engine time per request, measured in-process with performance.now()
 *    around runEmbed / runLocal. No HTTP, no database, no network: a hosted
 *    call adds its own round-trip on top.
 *  - Every measured request uses a distinct state string, so the embedding
 *    engine's per-text memo cache never answers the state from cache (option
 *    prototypes are cached after the first request, as in production).
 *  - A warm-up pass (not recorded) loads the ONNX session and the option
 *    prototypes first; one request at a time (no concurrency). Scenarios and
 *    engines are interleaved per iteration so background load is shared.
 *  - Determinism: the same fixed request is run 50 times; the share of runs
 *    whose answers are byte-identical to the first is reported.
 */
import { writeFile } from "node:fs/promises";
import { cpus, platform, release, arch, totalmem, loadavg } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: {
    "@/lib/db": join(root, "scripts/leaderboard-db-shim.mjs"),
    "@": join(root, "src"),
  },
});
const mod = (p) => jiti.import(join(root, p));

const ITERATIONS = Math.max(20, Number(process.env.BENCH_ITERATIONS) || 300);
const WARMUP = 20;
const DETERMINISM_RUNS = 50;

const { runLocal } = await mod("src/lib/jev/engine.ts");
const { runEmbed } = await mod("src/lib/jev/embed/run.server.ts");
const { embedCapability } = await mod("src/lib/jev/embed/encoder.server.ts");

// ─── Scenarios ───────────────────────────────────────────────────────────────

const TICKETS = [
  "I want to send back the jacket, it arrived in the wrong size",
  "My package has been stuck in transit for eight days",
  "I was charged twice for the same order this month",
  "Do you have a store in Berlin?",
  "The tracking number you sent does not work",
  "Please refund the shoes, they fell apart after a week",
  "Why did my card get declined at checkout?",
  "Can I change the delivery address after ordering?",
];
const SERVICES = ["checkout", "auth", "search", "payments", "inventory", "email"];
const LEVELS = ["info", "warn", "error"];
const LOG_MESSAGES = [
  "request completed",
  "login failed: bad password",
  "upstream timeout after retries",
  "card declined by issuer",
  "rate limit exceeded for client",
  "cache miss, recomputed",
];

const SCENARIOS = [
  {
    id: "ticket-routing",
    title: "Support ticket routing",
    inputShape: "1 × Choice (4 options) · free-text ticket · ~20 words",
    make: (i) => ({
      state: `${TICKETS[i % TICKETS.length]} (order #${10_000 + i})`,
      questions: {
        department: {
          type: "choice",
          instructions: "Which team should handle this support message?",
          criteria: {
            returns: "returns and refunds for items the customer wants to send back",
            shipping: "delivery, tracking, and packages in transit",
            billing: "charges, payments, invoices, and declined cards",
            general: "anything else, such as store locations or account questions",
          },
        },
      },
    }),
  },
  {
    id: "log-triage",
    title: "Log-event triage",
    inputShape: "1 × Choice (3 options) · structured JSON state",
    make: (i) => ({
      state: {
        service: SERVICES[i % SERVICES.length],
        level: LEVELS[i % LEVELS.length],
        message: LOG_MESSAGES[i % LOG_MESSAGES.length],
        duration_ms: 40 + ((i * 37) % 900),
        request_id: `req_${i.toString(36)}`,
      },
      questions: {
        action: {
          type: "choice",
          instructions: "What should happen with this log event?",
          criteria: {
            allow: "normal operation, nothing to do",
            review: "worth a human look but not urgent",
            block: "security or payment problem that needs action now",
          },
        },
      },
    }),
  },
  {
    id: "multi-question",
    title: "10 questions over one state",
    inputShape: "3 × Choice · 4 × Noul · 3 × Score · one free-text state",
    make: (i) => ({
      state: `${TICKETS[i % TICKETS.length]}. I have been a customer for ${1 + (i % 9)} years and this is really frustrating. (ticket ${i})`,
      questions: {
        department: {
          type: "choice",
          instructions: "Which team should handle this?",
          criteria: { returns: "returns and refunds", shipping: "delivery and tracking", billing: "charges and payments", general: "anything else" },
        },
        channel: {
          type: "choice",
          instructions: "Best reply channel?",
          criteria: { email: "email reply", phone: "phone call", chat: "live chat" },
        },
        language: {
          type: "choice",
          instructions: "Which language is the message written in?",
          criteria: { en: "English", de: "German", es: "Spanish" },
        },
        refund: { type: "noul", instructions: "Is the customer asking for money back?" },
        urgent: { type: "noul", instructions: "Does this need a reply within the hour?" },
        angry: { type: "noul", instructions: "Is the customer upset?" },
        loyal: { type: "noul", instructions: "Is this a long-time customer?" },
        frustration: {
          type: "score",
          instructions: "How frustrated is the customer?",
          criteria: ["calm", "mildly annoyed", "frustrated", "very frustrated", "furious"],
        },
        effort: {
          type: "score",
          instructions: "How much agent effort will this take?",
          criteria: ["trivial", "small", "moderate", "large"],
        },
        churn: {
          type: "score",
          instructions: "How likely is the customer to leave?",
          criteria: ["unlikely", "possible", "likely"],
        },
      },
    }),
  },
];

// ─── Measurement ─────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
const round2 = (n) => Math.round(n * 100) / 100;

function summarize(times) {
  const sorted = [...times].sort((x, y) => x - y);
  const mean = sorted.reduce((acc, t) => acc + t, 0) / sorted.length;
  return {
    p50_ms: round2(percentile(sorted, 50)),
    p95_ms: round2(percentile(sorted, 95)),
    mean_ms: round2(mean),
    max_ms: round2(sorted[sorted.length - 1]),
  };
}

async function determinism(run, scenario) {
  const fixed = scenario.make(42);
  const first = JSON.stringify((await run(fixed)).answers);
  let same = 0;
  for (let i = 0; i < DETERMINISM_RUNS; i++) {
    if (JSON.stringify((await run(fixed)).answers) === first) same += 1;
  }
  return round2((same / DETERMINISM_RUNS) * 100);
}

const cap = await embedCapability();
const engines = [
  {
    id: "lexical",
    label: "Lexical engine",
    available: true,
    run: async (req) => runLocal({ ...req, model: "system-one" }, "system-one"),
  },
  {
    id: "embedding",
    label: cap.available ? `Embedding engine (${cap.model})` : "Embedding engine",
    available: cap.available,
    reason: cap.available ? undefined : cap.reason,
    run: async (req) => runEmbed({ ...req, model: "system-one" }),
  },
];

const loadAtStart = loadavg()[0];
const results = {};
const live = engines.filter((e) => e.available);
const samples = new Map(); // `${scenario}:${engine}` -> ms[]
for (const s of SCENARIOS) {
  for (const e of live) {
    samples.set(`${s.id}:${e.id}`, []);
    for (let i = 0; i < WARMUP; i++) await e.run(s.make(1_000_000 + i));
  }
}
// Interleave scenarios and engines on every iteration so background load on
// the machine hits every cell equally instead of skewing whichever ran last.
for (let i = 0; i < ITERATIONS; i++) {
  for (const s of SCENARIOS) {
    for (const e of live) {
      const req = s.make(i);
      const t0 = performance.now();
      await e.run(req);
      samples.get(`${s.id}:${e.id}`).push(performance.now() - t0);
    }
  }
}
for (const s of SCENARIOS) {
  results[s.id] = {};
  for (const e of engines) {
    if (!e.available) {
      results[s.id][e.id] = null;
      continue;
    }
    results[s.id][e.id] = {
      ...summarize(samples.get(`${s.id}:${e.id}`)),
      determinism_pct: await determinism(e.run, s),
    };
    const r = results[s.id][e.id];
    console.log(`${s.id.padEnd(16)} ${e.id.padEnd(10)} p50 ${r.p50_ms} ms  p95 ${r.p95_ms} ms  (determinism ${r.determinism_pct}%)`);
  }
}

const cpuList = cpus();
const out = {
  measured_at: new Date().toISOString().slice(0, 10),
  machine: {
    cpu: cpuList[0]?.model ?? "unknown",
    cores: cpuList.length,
    memory_gb: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()} (${arch()})`,
    node: process.version,
    load_avg_1m_at_start: Math.round(loadAtStart * 10) / 10,
  },
  method: {
    scope: "engine time per request, in-process (no HTTP, no database, no network)",
    iterations: ITERATIONS,
    warmup: WARMUP,
    concurrency: 1,
    distinct_states: true,
    determinism_runs: DETERMINISM_RUNS,
    command: "npm run bench:latency",
  },
  engines: engines.map((e) => ({ id: e.id, label: e.label, available: e.available, reason: e.reason ?? null })),
  scenarios: SCENARIOS.map((s) => ({
    id: s.id,
    title: s.title,
    inputShape: s.inputShape,
    results: results[s.id],
  })),
};

await writeFile(join(root, "src/lib/content/latency-bench.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote src/lib/content/latency-bench.json");
