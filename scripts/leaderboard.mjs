#!/usr/bin/env node
/**
 * Public, reproducible leaderboard: scores every available backend on the
 * in-repo gold suite (accuracy + calibration) and the out-of-scope probe set,
 * then writes src/lib/content/leaderboard.json (committed; rendered at
 * /leaderboard).
 *
 *   npm run leaderboard
 *
 * Backends that need something this machine lacks are recorded as "not_run"
 * with the reason instead of being skipped silently:
 *   - otsone-1 / laya-*: a running sidecar (OTSONE_MODEL_URL / LAYA_ENGINE_URL)
 *   - llm + auto:        LEADERBOARD_INCLUDE_LLM=1 (opt-in: these rows spend
 *                        money on paid providers) plus GROQ_API_KEY,
 *                        OLLAMA_BASE_URL, or a paid provider key
 *   - jev (TypeSafe):    LEADERBOARD_INCLUDE_CLOUD=1 plus TYPESAFE_API_KEY +
 *                        TYPESAFE_BASE_URL (cloud backend)
 * Local rows are deterministic: anyone re-running gets identical numbers.
 *
 * Public-dataset tracks (Banking77, CLINC150 + out-of-scope, AG News) run when
 * LEADERBOARD_PUBLIC=1. Data is downloaded at run time into .cache/datasets/
 * (gitignored) and only the scores are written. Every backend that ran on the
 * gold suite is scored on the same deterministic sample of each test split:
 *   LEADERBOARD_PUBLIC_SAMPLE=500   rows per dataset (default 500; "all" = full split)
 *   LEADERBOARD_PUBLIC_ONLY=banking77,ag_news   subset of tracks
 *   LEADERBOARD_REFRESH=1           re-download instead of using the cache
 * Without LEADERBOARD_PUBLIC=1 the previously committed tracks are kept.
 */
import { readFile, writeFile } from "node:fs/promises";
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

// The harness sends ~300 requests; lift the preview LLM cap for this run only.
process.env.LLM_RATE_LIMIT_PER_5MIN ??= "100000";

const { scoreRunner, notRun } = await mod("src/lib/jev/leaderboard.ts");
const { runLocal } = await mod("src/lib/jev/engine.ts");
const { GOLD } = await mod("src/lib/jev/gold.ts");
const { OOD_CASES } = await mod("src/lib/jev/gold/ood.ts");

const rows = [];
/** Every backend that ran on the gold suite, reused for the public tracks. */
const runners = [];
const scoreAndKeep = async (meta, runner) => {
  const row = await scoreRunner(meta, runner);
  runners.push({ meta, runner });
  return row;
};

// Default engine: the sentence-embedding engine when its model is installed
// (scripts/embed-download.sh), otherwise recorded as not run.
const { runEmbed } = await mod("src/lib/jev/embed/run.server.ts");
const { embedCapability } = await mod("src/lib/jev/embed/encoder.server.ts");
const embedCap = await embedCapability();
const { EMBED_PARAMS } = await mod("src/lib/jev/embed/params.ts");
const embedRunner = async (req) => runEmbed({ ...req, model: "system-one" });
rows.push(
  embedCap.available
    ? await scoreAndKeep(
        { id: "system-one", label: `System One, embedding engine (${embedCap.model})`, kind: "local" },
        embedRunner,
      )
    : notRun(
        { id: "system-one", label: "System One, embedding engine", kind: "local" },
        `embedding model not installed (${embedCap.reason}); run scripts/embed-download.sh`,
      ),
);

// The lexical (TF-IDF) engine: the fallback when no embedding model is present,
// and the weight presets that only exist for it.
for (const [id, label, model] of [
  ["system-one-lexical", "System One, lexical engine (fallback)", "system-one"],
  ["jev-v13", "Sharp (lexical)", "jev-v13"],
  ["decisive", "Decisive (lexical)", "decisive"],
  ["contrastive", "Contrastive (lexical)", "contrastive"],
]) {
  rows.push(
    await scoreAndKeep({ id, label, kind: "local" }, async (req) => runLocal({ ...req, model }, model)),
  );
}

// Ablation: the default engine with the out-of-scope damping switched off (per
// call, so the runner can be reused on the public tracks).
const withoutScope = async (req) => {
  process.env.OTS_SCOPE_DAMPING = "off";
  try {
    return embedCap.available
      ? await embedRunner(req)
      : runLocal({ ...req, model: "system-one" }, "system-one");
  } finally {
    delete process.env.OTS_SCOPE_DAMPING;
  }
};
rows.push(
  await scoreAndKeep(
    {
      id: "system-one-noscope",
      label: `System One without scope layer (ablation, ${embedCap.available ? "embedding" : "lexical"} engine)`,
      kind: "ablation",
    },
    withoutScope,
  ),
);

const { applyScope } = await mod("src/lib/jev/scope.ts");
const scoped = (req, out) =>
  out ? { ...out, answers: applyScope(req, out.answers, { damp: true }) } : null;

const ots = await mod("src/lib/jev/otsone.server.ts");
const otsHealth = await ots.otsoneHealth().catch(() => ({ ok: false }));
rows.push(
  otsHealth.ok
    ? await scoreAndKeep({ id: "otsone-1", label: "OpenJev One (otsone-1)", kind: "neural" }, async (req) =>
        scoped(req, await ots.runOtsone({ ...req, model: "otsone-1" })),
      )
    : notRun(
        { id: "otsone-1", label: "OpenJev One (otsone-1)", kind: "neural" },
        "otsone sidecar not reachable (OTSONE_MODEL_URL)",
      ),
);

const laya = await mod("src/lib/jev/laya.server.ts");
const layaHealth = await laya.layaHealth().catch(() => ({ ok: false }));
const layaId = laya.layaBackend() === "onnx" ? "laya-onnx" : "laya-mlx";
rows.push(
  layaHealth.ok
    ? await scoreAndKeep({ id: layaId, label: `Laya (${laya.layaBackend()})`, kind: "neural" }, async (req) =>
        scoped(req, await laya.runLaya({ ...req, model: layaId })),
      )
    : notRun({ id: layaId, label: "Laya", kind: "neural" }, "Laya sidecar not reachable (LAYA_ENGINE_URL)"),
);

const llm = await mod("src/lib/jev/llm.server.ts");
const chain = llm.resolveProviderChain();
const includeLlm = process.env.LEADERBOARD_INCLUDE_LLM === "1";
if (chain.length > 0 && includeLlm) {
  const first = chain[0];
  rows.push(
    await scoreAndKeep(
      { id: "llm", label: `LLM (${first.provider}:${first.model})`, kind: "llm" },
      async (req) => {
        const r = await llm.escalateToLlm(req);
        return r.ok
          ? { model: r.model, answers: r.answers, usage: r.usage, latency_ms: r.latency_ms }
          : null;
      },
    ),
  );
  const run = await mod("src/lib/jev/run.ts");
  rows.push(
    await scoreAndKeep({ id: "auto", label: "Auto cascade (local + LLM when unsure)", kind: "cascade" }, (req) =>
      run.serveSystemOne({ ...req, model: "auto" }),
    ),
  );
} else {
  const why =
    chain.length === 0
      ? "no LLM configured (GROQ_API_KEY, OLLAMA_BASE_URL, or a paid provider key)"
      : "LLM rows are opt-in: re-run with LEADERBOARD_INCLUDE_LLM=1";
  rows.push(notRun({ id: "llm", label: "LLM (verbalized confidence)", kind: "llm" }, why));
  rows.push(notRun({ id: "auto", label: "Auto cascade", kind: "cascade" }, why));
}

const cloud = await mod("src/lib/jev/cloud.server.ts");
rows.push(
  cloud.cloudConfigured() && process.env.LEADERBOARD_INCLUDE_CLOUD === "1"
    ? await scoreAndKeep({ id: "cloud", label: `Hosted System One (${cloud.cloudModel()})`, kind: "cloud" }, async (req) =>
        cloud.runCloud({ ...req, model: "system-one-cloud" }),
      )
    : notRun(
        { id: "cloud", label: "Hosted System One (e.g. Jev)", kind: "cloud" },
        cloud.cloudConfigured()
          ? "cloud rows are opt-in: re-run with LEADERBOARD_INCLUDE_CLOUD=1"
          : "cloud endpoint not configured (TYPESAFE_API_KEY + TYPESAFE_BASE_URL)",
      ),
);

// Latency depends on the machine; keep the committed file deterministic by
// recording it only when explicitly requested.
const keepLatency = process.env.LEADERBOARD_LATENCY === "1";
const target = join(root, "src/lib/content/leaderboard.json");

// ---------------------------------------------------------------------------
// Public-dataset tracks
// ---------------------------------------------------------------------------
async function publicTracks() {
  const previous = (await readFile(target, "utf8").then(JSON.parse).catch(() => null))?.public_tracks;
  if (process.env.LEADERBOARD_PUBLIC !== "1") return previous;
  const { PUBLIC_DATASETS, loadPublicDataset, sampleExamples, isOutOfScope } = await mod(
    "src/lib/jev/public-datasets.ts",
  );
  const { scorePublicTrack } = await mod("src/lib/jev/leaderboard.ts");
  const rawSample = process.env.LEADERBOARD_PUBLIC_SAMPLE ?? "500";
  const sampleSize = rawSample === "all" ? Number.POSITIVE_INFINITY : Number(rawSample);
  if (!(sampleSize > 0)) throw new Error(`LEADERBOARD_PUBLIC_SAMPLE must be a positive number or "all", got ${rawSample}`);
  const only = process.env.LEADERBOARD_PUBLIC_ONLY?.split(",").map((x) => x.trim()).filter(Boolean);
  const cacheDir = join(root, ".cache", "datasets");
  const tracks = [];
  for (const spec of PUBLIC_DATASETS) {
    if (only && !only.includes(spec.id)) continue;
    const ds = await loadPublicDataset(spec, { cacheDir, refresh: process.env.LEADERBOARD_REFRESH === "1" });
    const sample = sampleExamples(ds.examples, sampleSize);
    const trackRows = [];
    for (const r of rows) {
      const found = runners.find((x) => x.meta.id === r.id);
      if (r.status !== "ok" || !found) {
        trackRows.push({ id: r.id, label: r.label, kind: r.kind, status: "not_run", reason: r.reason ?? "not run on the gold suite" });
        continue;
      }
      const row = await scorePublicTrack(found.meta, found.runner, ds, sample);
      trackRows.push(keepLatency ? row : { ...row, latency_ms: undefined });
      process.stdout.write(
        `${spec.id.padEnd(14)} ${r.id.padEnd(20)} acc=${row.accuracy} ece=${row.ece}${row.ood ? ` oos@5%fpr=${row.ood.flag_rate_at_5_fpr} auroc=${row.ood.auroc}` : ""}\n`,
      );
    }
    tracks.push({
      id: spec.id,
      name: spec.name,
      description: spec.description,
      homepage: spec.homepage,
      license: spec.license,
      split: spec.split,
      classes: ds.classes.length,
      total: ds.examples.length,
      sampled: sample.length,
      oos_sampled: sample.filter((e) => isOutOfScope(ds, e)).length,
      rows: trackRows,
    });
  }
  // A partial run (LEADERBOARD_PUBLIC_ONLY) keeps the other committed tracks.
  const kept = (previous ?? []).filter((t) => !tracks.some((n) => n.id === t.id));
  const order = PUBLIC_DATASETS.map((d) => d.id);
  return [...tracks, ...kept].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

const out = {
  generated_at: process.env.LEADERBOARD_DATE ?? new Date().toISOString().slice(0, 10),
  harness: "scripts/leaderboard.mjs + src/lib/jev/leaderboard.ts + src/lib/jev/public-datasets.ts",
  embedding_engine: embedCap.available
    ? { encoder: embedCap.model, fitted_on: EMBED_PARAMS.fitted_on }
    : { not_installed: embedCap.reason },
  datasets: { gold_cases: GOLD.length, ood_pairs: OOD_CASES.length },
  rows: rows.map((r) => (keepLatency ? r : { ...r, latency_ms: undefined })),
  public_tracks: await publicTracks(),
};
await writeFile(target, JSON.stringify(out, null, 2) + "\n");
for (const r of rows) {
  const g = r.gold;
  const o = r.ood;
  process.stdout.write(
    r.status === "ok"
      ? `${r.id.padEnd(20)} acc=${g.accuracy} ece=${g.ece} brier=${g.brier} ood_flag=${o.flag_rate} ood_conf>=0.9=${o.confident_rate}\n`
      : `${r.id.padEnd(20)} not run: ${r.reason}\n`,
  );
}
process.stdout.write(`wrote ${target}\n`);
