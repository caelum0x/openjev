/**
 * Sentence encoder for the embedding engine: an ONNX BERT-style model
 * (default: gte-small, int8-quantized, 33 MB, MIT) run in-process on CPU with
 * `onnxruntime-node`, tokenized by the dependency-free WordPiece in
 * ./wordpiece.ts.
 *
 * Everything here is optional at runtime. When the model directory or the
 * onnxruntime-node package is missing, `embedCapability()` reports why and
 * the System One engine falls back to the lexical (TF-IDF) engine. Weights are
 * never committed; `scripts/embed-download.sh` fetches them (docs/WEIGHTS.md).
 *
 * Config (env):
 *   OPENJEV_EMBED_MODEL_PATH  model dir (default ./models/embed/gte-small)
 *   OPENJEV_EMBED=off         force the lexical engine
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encode, wordPieceFromTokenizerJson, type WordPieceConfig } from "./wordpiece.ts";

export type Pooling = "mean" | "cls";

export type EmbedManifest = {
  /** Model id reported in responses and the leaderboard, e.g. `gte-small-int8`. */
  id: string;
  pooling: Pooling;
  /** Prefix added to state text (e.g. bge's retrieval instruction); default none. */
  queryPrefix: string;
  /** Prefix added to option / example text; default none. */
  docPrefix: string;
  maxLength: number;
  onnxFile: string;
};

export type EmbedCapability =
  | { available: true; engine: "embedding"; model: string; dir: string }
  | { available: false; engine: "lexical"; reason: string };

export const DEFAULT_EMBED_DIR = "models/embed/gte-small";
const ONNX_CANDIDATES = ["model_quantized.onnx", "model.onnx"];
const CACHE_LIMIT = 20_000;
/**
 * Texts are encoded one at a time: the int8 model quantizes activations per
 * tensor, so padding a batch shifts every vector slightly. Unbatched runs make
 * an embedding depend only on its text (reproducible leaderboard numbers).
 */
const BATCH = 1;

export function embedDir(): string {
  return resolve(process.env.OPENJEV_EMBED_MODEL_PATH ?? DEFAULT_EMBED_DIR);
}

/** Read `embed.json` if present; otherwise infer defaults from the directory. */
export function readManifest(dir: string): EmbedManifest | { error: string } {
  if (!existsSync(join(dir, "tokenizer.json"))) return { error: `no tokenizer.json in ${dir}` };
  let raw: Partial<{
    id: string;
    pooling: string;
    query_prefix: string;
    doc_prefix: string;
    max_length: number;
    onnx_file: string;
  }> = {};
  const manifestPath = join(dir, "embed.json");
  if (existsSync(manifestPath)) {
    try {
      raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (err) {
      return { error: `invalid embed.json: ${(err as Error).message}` };
    }
  }
  const onnxFile = raw.onnx_file ?? ONNX_CANDIDATES.find((f) => existsSync(join(dir, f)));
  if (!onnxFile || !existsSync(join(dir, onnxFile))) return { error: `no ONNX model in ${dir}` };
  const pooling: Pooling = raw.pooling === "cls" ? "cls" : "mean";
  return {
    id: raw.id ?? dir.split(/[\\/]/).filter(Boolean).pop() ?? "embed",
    pooling,
    queryPrefix: raw.query_prefix ?? "",
    docPrefix: raw.doc_prefix ?? "",
    maxLength: Math.min(512, Math.max(16, raw.max_length ?? 256)),
    onnxFile,
  };
}

type OrtModule = typeof import("onnxruntime-node");
type Session = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;

type Loaded = {
  ort: OrtModule;
  session: Session;
  tokenizer: WordPieceConfig;
  manifest: EmbedManifest;
  needsTokenTypes: boolean;
  dir: string;
};

let loading: Promise<Loaded | { error: string }> | null = null;
let loadedDir: string | null = null;
const cache = new Map<string, Float32Array>();

function disabled(): boolean {
  const v = process.env.OPENJEV_EMBED?.toLowerCase();
  return v === "off" || v === "0" || v === "false";
}

async function load(dir: string): Promise<Loaded | { error: string }> {
  const manifest = readManifest(dir);
  if ("error" in manifest) return manifest;
  let ort: OrtModule;
  try {
    ort = (await import("onnxruntime-node")) as OrtModule;
  } catch (err) {
    return {
      error: `onnxruntime-node is not installed (${(err as Error).message.split("\n")[0]})`,
    };
  }
  try {
    const tokenizer = wordPieceFromTokenizerJson(
      JSON.parse(readFileSync(join(dir, "tokenizer.json"), "utf8")),
    );
    const session = await ort.InferenceSession.create(join(dir, manifest.onnxFile), {
      graphOptimizationLevel: "all",
    });
    return {
      ort,
      session,
      tokenizer,
      manifest,
      needsTokenTypes: session.inputNames.includes("token_type_ids"),
      dir,
    };
  } catch (err) {
    return { error: `failed to load embedding model: ${(err as Error).message.split("\n")[0]}` };
  }
}

async function ensureLoaded(): Promise<Loaded | { error: string }> {
  if (disabled()) return { error: "disabled by OPENJEV_EMBED=off" };
  const dir = embedDir();
  if (!loading || loadedDir !== dir) {
    loadedDir = dir;
    cache.clear();
    loading = load(dir);
  }
  return loading;
}

/** Whether the embedding engine can run here, and if not, why. Loads lazily. */
export async function embedCapability(): Promise<EmbedCapability> {
  const l = await ensureLoaded();
  if ("error" in l) return { available: false, engine: "lexical", reason: l.error };
  return { available: true, engine: "embedding", model: l.manifest.id, dir: l.dir };
}

/** Cheap, synchronous presence check (no model load) for status pages. */
export function embedModelPresent(): boolean {
  if (disabled()) return false;
  return !("error" in readManifest(embedDir()));
}

function pool(
  hidden: Float32Array,
  dims: readonly number[],
  masks: number[][],
  pooling: Pooling,
): Float32Array[] {
  const [batch, seq, dim] = dims as [number, number, number];
  const out: Float32Array[] = [];
  for (let b = 0; b < batch; b++) {
    const v = new Float32Array(dim);
    const base = b * seq * dim;
    if (pooling === "cls") {
      v.set(hidden.subarray(base, base + dim));
    } else {
      let n = 0;
      for (let t = 0; t < seq; t++) {
        if (!masks[b]![t]) continue;
        n += 1;
        const off = base + t * dim;
        for (let d = 0; d < dim; d++) v[d]! += hidden[off + d]!;
      }
      for (let d = 0; d < dim; d++) v[d]! /= Math.max(1, n);
    }
    let norm = 0;
    for (let d = 0; d < dim; d++) norm += v[d]! * v[d]!;
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dim; d++) v[d]! /= norm;
    out.push(v);
  }
  return out;
}

async function runBatch(l: Loaded, texts: readonly string[]): Promise<Float32Array[]> {
  const encs = texts.map((t) => encode(t, l.tokenizer, l.manifest.maxLength));
  const seq = Math.max(...encs.map((e) => e.ids.length));
  const n = encs.length;
  const ids = new BigInt64Array(n * seq);
  const mask = new BigInt64Array(n * seq);
  const masks: number[][] = [];
  encs.forEach((e, b) => {
    const m: number[] = [];
    for (let t = 0; t < seq; t++) {
      const on = t < e.ids.length;
      ids[b * seq + t] = BigInt(on ? e.ids[t]! : 0);
      mask[b * seq + t] = on ? 1n : 0n;
      m.push(on ? 1 : 0);
    }
    masks.push(m);
  });
  const feeds: Record<string, InstanceType<OrtModule["Tensor"]>> = {
    input_ids: new l.ort.Tensor("int64", ids, [n, seq]),
    attention_mask: new l.ort.Tensor("int64", mask, [n, seq]),
  };
  if (l.needsTokenTypes)
    feeds.token_type_ids = new l.ort.Tensor("int64", new BigInt64Array(n * seq), [n, seq]);
  const result = await l.session.run(feeds);
  const first = result[l.session.outputNames[0]!]!;
  return pool(first.data as Float32Array, first.dims, masks, l.manifest.pooling);
}

export type Embedder = (texts: readonly string[], kind: "query" | "doc") => Promise<Float32Array[]>;

/**
 * Embed texts (unit-normalized). Results are memoized by text so option
 * prototypes are computed once per distinct question schema. Throws when the
 * model is unavailable; call `embedCapability()` first.
 */
export const embedTexts: Embedder = async (texts, kind) => {
  const l = await ensureLoaded();
  if ("error" in l) throw new Error(l.error);
  const prefix = kind === "query" ? l.manifest.queryPrefix : l.manifest.docPrefix;
  const keyed = texts.map((t) => prefix + t);
  const missing = [...new Set(keyed.filter((k) => !cache.has(k)))];
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const vecs = await runBatch(l, chunk);
    chunk.forEach((k, j) => {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(k, vecs[j]!);
    });
  }
  return keyed.map((k) => cache.get(k)!);
};
