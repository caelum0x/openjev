/**
 * Public-dataset leaderboard tracks: Banking77, CLINC150 (plus, with its
 * out-of-scope test set) and AG News.
 *
 * The in-repo gold suite is ours; these are standard public test sets anyone
 * can re-run. Data is downloaded at run time and cached under
 * `.cache/datasets/` (gitignored); nothing from the datasets is committed, only
 * the scores. Each example becomes one Choice question whose options are the
 * dataset's classes, so every backend answers the exact same request.
 *
 * Sources:
 *  - Banking77: the PolyAI CSV (text,category), CC-BY-4.0.
 *  - CLINC150 plus: Hugging Face `clinc/clinc_oos` (config `plus`), CC-BY-3.0;
 *    the `oos` class is NOT offered as an option, so out-of-scope rows test
 *    whether a backend admits it does not know.
 *  - AG News: Hugging Face `fancyzhx/ag_news`; see the dataset card for terms.
 *
 * Pure apart from the injected fetch and the cache directory: unit-tested with
 * node:test using a fake fetch.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SystemOneRequest } from "./types.ts";

export type PublicDatasetId = "banking77" | "clinc150_oos" | "ag_news";

type CsvSource = { kind: "csv"; url: string; textColumn: string; labelColumn: string };
type HfRowsSource = {
  kind: "hf-rows";
  dataset: string;
  config: string;
  split: string;
  textField: string;
  labelField: string;
};

export type PublicDatasetSpec = {
  id: PublicDatasetId;
  name: string;
  description: string;
  homepage: string;
  license: string;
  split: string;
  source: CsvSource | HfRowsSource;
  /** Choice question wording; `text` is the state key. */
  instructions: string;
  /** Label that marks an out-of-scope row (never offered as an option). */
  oosLabel?: string;
  /**
   * Option descriptions for classes whose names alone are ambiguous. Every
   * backend receives the same request, so this is part of the task, not a
   * per-model hint. Classes without an entry are described by their name.
   */
  labelDescriptions?: Readonly<Record<string, string>>;
};

export const PUBLIC_DATASETS: readonly PublicDatasetSpec[] = [
  {
    id: "banking77",
    name: "Banking77",
    description: "Online-banking customer queries, 77 fine-grained intents.",
    homepage: "https://github.com/PolyAI-LDN/task-specific-datasets",
    license: "CC-BY-4.0",
    split: "test",
    source: {
      kind: "csv",
      url: "https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/master/banking_data/test.csv",
      textColumn: "text",
      labelColumn: "category",
    },
    instructions: "Which banking support intent does `text` express?",
  },
  {
    id: "clinc150_oos",
    name: "CLINC150 + out-of-scope",
    description:
      "Assistant queries over 150 intents in 10 domains, plus queries that fit none of them.",
    homepage: "https://huggingface.co/datasets/clinc/clinc_oos",
    license: "CC-BY-3.0",
    split: "test",
    source: {
      kind: "hf-rows",
      dataset: "clinc/clinc_oos",
      config: "plus",
      split: "test",
      textField: "text",
      labelField: "intent",
    },
    instructions: "Which assistant intent does `text` ask for?",
    oosLabel: "oos",
  },
  {
    id: "ag_news",
    name: "AG News",
    description: "News articles in four topics.",
    homepage: "https://huggingface.co/datasets/fancyzhx/ag_news",
    license: "See the dataset card",
    split: "test",
    source: {
      kind: "hf-rows",
      dataset: "fancyzhx/ag_news",
      config: "default",
      split: "test",
      textField: "text",
      labelField: "label",
    },
    instructions: "Main topic of the news article in `text`?",
    labelDescriptions: {
      World: "World news: international affairs, politics, governments, conflicts.",
      Sports: "Sports: games, teams, athletes, leagues, results.",
      Business: "Business: companies, markets, earnings, the economy.",
      "Sci/Tech": "Science and technology: computing, the internet, software, space, research.",
    },
  },
];

export type DatasetExample = { text: string; label: string };

export type LoadedDataset = {
  spec: PublicDatasetSpec;
  /** In-scope classes, in first-seen order (the Choice options). */
  classes: string[];
  examples: DatasetExample[];
};

export type Fetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function specById(id: string): PublicDatasetSpec | undefined {
  return PUBLIC_DATASETS.find((d) => d.id === id);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. First row is the header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}

/** "card_arrival" -> "card arrival"; used as the option description. */
export function humanizeLabel(label: string): string {
  return label.replace(/_/g, " ").trim();
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function toLoaded(spec: PublicDatasetSpec, examples: DatasetExample[]): LoadedDataset {
  const classes = uniqueInOrder(examples.map((e) => e.label)).filter((l) => l !== spec.oosLabel);
  return { spec, classes, examples };
}

// ---------------------------------------------------------------------------
// Sampling + requests
// ---------------------------------------------------------------------------

const hashKey = (s: string): string => createHash("sha256").update(s).digest("hex");

/**
 * Deterministic sample of `n` examples: order by sha256(seed + text) and take
 * the first n. Class proportions (including the out-of-scope share) follow the
 * source split in expectation, and anyone re-running gets the same rows.
 */
export function sampleExamples(
  examples: readonly DatasetExample[],
  n: number,
  seed = "openjev-leaderboard-v1",
): DatasetExample[] {
  if (n >= examples.length) return [...examples];
  return examples
    .map((e, i) => ({ e, k: hashKey(`${seed}\u0000${i}\u0000${e.text}`) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, Math.max(0, n))
    .map((x) => x.e);
}

export const QUESTION_ID = "label";

/** One System One request per example: a single Choice over the in-scope classes. */
export function toRequest(ds: LoadedDataset, example: DatasetExample): SystemOneRequest {
  return {
    state: { text: example.text },
    questions: {
      [QUESTION_ID]: {
        type: "choice",
        instructions: ds.spec.instructions,
        criteria: Object.fromEntries(
          ds.classes.map((c) => [c, ds.spec.labelDescriptions?.[c] ?? humanizeLabel(c)]),
        ),
      },
    },
  };
}

export function isOutOfScope(ds: LoadedDataset, example: DatasetExample): boolean {
  return ds.spec.oosLabel !== undefined && example.label === ds.spec.oosLabel;
}

// ---------------------------------------------------------------------------
// Download + cache
// ---------------------------------------------------------------------------

const HF_ROWS = "https://datasets-server.huggingface.co/rows";
const HF_PAGE = 100;
const MAX_ROWS = 20_000;

/** Pause between rows-API pages, to stay under the public API's rate limit. */
const PAGE_DELAY_MS = 1000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type RetryPolicy = { attempts: number; baseDelayMs: number };
const DEFAULT_RETRY: RetryPolicy = { attempts: 7, baseDelayMs: 1000 };

async function fetchText(fetchImpl: Fetch, url: string, retry: RetryPolicy): Promise<string> {
  let lastStatus = 0;
  for (let i = 0; i < retry.attempts; i++) {
    const res = await fetchImpl(url);
    if (res.ok) return res.text();
    lastStatus = res.status;
    if (res.status !== 429 && res.status < 500) break;
    if (i < retry.attempts - 1) await sleep(retry.baseDelayMs * 2 ** i);
  }
  throw new Error(`Download failed (${lastStatus}): ${url}`);
}

async function downloadCsv(
  spec: PublicDatasetSpec,
  src: CsvSource,
  fetchImpl: Fetch,
  retry: RetryPolicy,
): Promise<DatasetExample[]> {
  const rows = parseCsv(await fetchText(fetchImpl, src.url, retry));
  const out = rows
    .map((r) => ({
      text: (r[src.textColumn] ?? "").trim(),
      label: (r[src.labelColumn] ?? "").trim(),
    }))
    .filter((e) => e.text && e.label);
  if (out.length === 0)
    throw new Error(`${spec.name}: no rows with ${src.textColumn}/${src.labelColumn}.`);
  return out;
}

type HfRowsPage = {
  features?: Array<{ name: string; type?: { names?: string[] } }>;
  rows?: Array<{ row: Record<string, unknown> }>;
  num_rows_total?: number;
};

type Progress = { offset: number; names: string[] | null; examples: DatasetExample[] };

/**
 * Page through the Hugging Face rows API. Progress is checkpointed to
 * `partialFile` after every page, so a run cut short by the API's rate limit
 * resumes where it stopped instead of starting over.
 */
async function downloadHfRows(
  spec: PublicDatasetSpec,
  src: HfRowsSource,
  fetchImpl: Fetch,
  retry: RetryPolicy,
  pageDelayMs: number,
  partialFile: string,
): Promise<DatasetExample[]> {
  const base = `${HF_ROWS}?dataset=${encodeURIComponent(src.dataset)}&config=${encodeURIComponent(src.config)}&split=${encodeURIComponent(src.split)}`;
  const saved = await readFile(partialFile, "utf8")
    .then((t) => JSON.parse(t) as Progress)
    .catch(() => null);
  const progress: Progress = saved ?? { offset: 0, names: null, examples: [] };
  let total = Number.POSITIVE_INFINITY;
  let first = true;
  while (progress.offset < Math.min(total, MAX_ROWS)) {
    if (!first && pageDelayMs > 0) await sleep(pageDelayMs);
    first = false;
    const page = JSON.parse(
      await fetchText(fetchImpl, `${base}&offset=${progress.offset}&length=${HF_PAGE}`, retry),
    ) as HfRowsPage;
    const names =
      progress.names ?? page.features?.find((f) => f.name === src.labelField)?.type?.names;
    if (!names)
      throw new Error(`${spec.name}: label field "${src.labelField}" has no class names.`);
    total = page.num_rows_total ?? 0;
    const rows = page.rows ?? [];
    if (rows.length === 0) break;
    const added: DatasetExample[] = [];
    for (const { row } of rows) {
      const text = String(row[src.textField] ?? "").trim();
      const label = names[Number(row[src.labelField])];
      if (text && label !== undefined) added.push({ text, label });
    }
    progress.names = names;
    progress.examples = [...progress.examples, ...added];
    progress.offset += HF_PAGE;
    await writeFile(partialFile, JSON.stringify(progress));
  }
  if (progress.examples.length === 0)
    throw new Error(`${spec.name}: the rows API returned no data.`);
  return progress.examples;
}

export type LoadOptions = {
  cacheDir: string;
  fetchImpl?: Fetch;
  /** Ignore the cache and download again. */
  refresh?: boolean;
  retry?: RetryPolicy;
  /** Pause between rows-API pages (default 350 ms). */
  pageDelayMs?: number;
};

/** Load a dataset from the cache, downloading (and caching) it on first use. */
export async function loadPublicDataset(
  spec: PublicDatasetSpec,
  opts: LoadOptions,
): Promise<LoadedDataset> {
  const file = join(opts.cacheDir, `${spec.id}-${spec.split}.json`);
  if (!opts.refresh) {
    const cached = await readFile(file, "utf8").catch(() => null);
    if (cached) {
      const examples = JSON.parse(cached) as DatasetExample[];
      if (Array.isArray(examples) && examples.length > 0) return toLoaded(spec, examples);
    }
  }
  const fetchImpl: Fetch = opts.fetchImpl ?? ((url) => fetch(url));
  const retry = opts.retry ?? DEFAULT_RETRY;
  await mkdir(opts.cacheDir, { recursive: true });
  const partial = join(opts.cacheDir, `${spec.id}-${spec.split}.partial.json`);
  if (opts.refresh) await rm(partial, { force: true });
  const examples =
    spec.source.kind === "csv"
      ? await downloadCsv(spec, spec.source, fetchImpl, retry)
      : await downloadHfRows(
          spec,
          spec.source,
          fetchImpl,
          retry,
          opts.pageDelayMs ?? PAGE_DELAY_MS,
          partial,
        );
  await writeFile(file, JSON.stringify(examples));
  await rm(partial, { force: true });
  return toLoaded(spec, examples);
}
