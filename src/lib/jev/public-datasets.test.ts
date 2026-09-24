import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auroc, flagRateAtFpr, oosScore, scorePublicTrack } from "./leaderboard.ts";
import {
  humanizeLabel,
  loadPublicDataset,
  parseCsv,
  sampleExamples,
  specById,
  toLoaded,
  toRequest,
  type Fetch,
} from "./public-datasets.ts";
import type { SystemOneRequest, SystemOneResponse } from "./types.ts";

test("CSV parser handles quotes, doubled quotes, commas and CRLF", () => {
  const rows = parseCsv('text,category\r\n"Hi, there",a_b\r\n"He said ""no""",c\nplain,d\n\n');
  assert.deepEqual(rows, [
    { text: "Hi, there", category: "a_b" },
    { text: 'He said "no"', category: "c" },
    { text: "plain", category: "d" },
  ]);
  assert.deepEqual(parseCsv(""), []);
});

test("labels are humanised and oos is never an option", () => {
  assert.equal(humanizeLabel("card_arrival"), "card arrival");
  const spec = specById("clinc150_oos")!;
  const ds = toLoaded(spec, [
    { text: "set a timer", label: "timer" },
    { text: "how do I bake bread", label: "oos" },
    { text: "weather today", label: "weather" },
  ]);
  assert.deepEqual(ds.classes, ["timer", "weather"]);
  const req = toRequest(ds, ds.examples[1]!);
  assert.deepEqual(req.state, { text: "how do I bake bread" });
  const q = req.questions.label!;
  assert.equal(q.type, "choice");
  assert.deepEqual(q.type === "choice" ? q.criteria : null, { timer: "timer", weather: "weather" });
});

test("sampling is deterministic and bounded", () => {
  const all = Array.from({ length: 50 }, (_, i) => ({ text: `row ${i}`, label: i % 2 ? "a" : "b" }));
  const a = sampleExamples(all, 10);
  assert.equal(a.length, 10);
  assert.deepEqual(a, sampleExamples(all, 10));
  assert.notDeepEqual(a, sampleExamples(all, 10, "other-seed"));
  assert.equal(sampleExamples(all, 500).length, 50);
});

function fakeFetch(routes: Record<string, string>, calls: string[]): Fetch {
  return async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    return hit
      ? { ok: true, status: 200, text: async () => hit[1] }
      : { ok: false, status: 404, text: async () => "" };
  };
}

test("CSV datasets download once, then load from the cache", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openjev-ds-"));
  try {
    const calls: string[] = [];
    const fetchImpl = fakeFetch({ "banking_data/test.csv": "text,category\nWhere is my card?,card_arrival\nBlocked,card_blocked\n" }, calls);
    const spec = specById("banking77")!;
    const first = await loadPublicDataset(spec, { cacheDir: dir, fetchImpl });
    assert.deepEqual(first.classes, ["card_arrival", "card_blocked"]);
    assert.equal(calls.length, 1);
    const second = await loadPublicDataset(spec, { cacheDir: dir, fetchImpl });
    assert.equal(second.examples.length, 2);
    assert.equal(calls.length, 1, "second load must come from the cache");
    const cached = JSON.parse(await readFile(join(dir, "banking77-test.json"), "utf8"));
    assert.equal(cached.length, 2);
    await loadPublicDataset(spec, { cacheDir: dir, fetchImpl, refresh: true });
    assert.equal(calls.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Hugging Face rows are paged and label ids mapped to names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openjev-ds-"));
  try {
    const calls: string[] = [];
    const features = [{ name: "text" }, { name: "label", type: { names: ["World", "Sports", "Business", "Sci/Tech"] } }];
    const page = (rows: Array<[string, number]>) =>
      JSON.stringify({ features, rows: rows.map(([text, label]) => ({ row: { text, label } })), num_rows_total: 101 });
    const fetchImpl = fakeFetch(
      {
        "offset=0&": page(Array.from({ length: 100 }, (_, i) => [`story ${i}`, i % 4] as [string, number])),
        "offset=100&": page([["last story", 1]]),
      },
      calls,
    );
    const ds = await loadPublicDataset(specById("ag_news")!, { cacheDir: dir, fetchImpl, pageDelayMs: 0 });
    assert.equal(ds.examples.length, 101);
    assert.equal(ds.examples[100]!.label, "Sports");
    assert.deepEqual(ds.classes, ["World", "Sports", "Business", "Sci/Tech"]);
    assert.equal(calls.length, 2);
    assert.ok(calls[0]!.includes("dataset=fancyzhx%2Fag_news"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an interrupted rows download resumes from its checkpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openjev-ds-"));
  try {
    const features = [{ name: "text" }, { name: "label", type: { names: ["World", "Sports"] } }];
    const page = (text: string) =>
      JSON.stringify({ features, rows: [{ row: { text, label: 0 } }], num_rows_total: 200 });
    const calls: string[] = [];
    let failSecond = true;
    const fetchImpl: Fetch = async (url) => {
      calls.push(url);
      if (url.includes("offset=100&") && failSecond) return { ok: false, status: 429, text: async () => "" };
      return { ok: true, status: 200, text: async () => page(url.includes("offset=0&") ? "first" : "second") };
    };
    const opts = { cacheDir: dir, fetchImpl, pageDelayMs: 0, retry: { attempts: 1, baseDelayMs: 1 } };
    await assert.rejects(loadPublicDataset(specById("ag_news")!, opts), /429/);
    failSecond = false;
    const ds = await loadPublicDataset(specById("ag_news")!, opts);
    assert.deepEqual(ds.examples.map((e) => e.text), ["first", "second"]);
    assert.equal(calls.filter((u) => u.includes("offset=0&")).length, 1, "page 0 is not fetched again");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rate-limited pages are retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openjev-ds-"));
  try {
    let n = 0;
    const fetchImpl: Fetch = async () => {
      n += 1;
      return n === 1
        ? { ok: false, status: 429, text: async () => "" }
        : { ok: true, status: 200, text: async () => "text,category\nhello,greeting\nbye,farewell\n" };
    };
    const ds = await loadPublicDataset(specById("banking77")!, {
      cacheDir: dir,
      fetchImpl,
      retry: { attempts: 3, baseDelayMs: 1 },
    });
    assert.equal(ds.examples.length, 2);
    assert.equal(n, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed download is an error, not an empty track", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openjev-ds-"));
  try {
    await assert.rejects(
      loadPublicDataset(specById("banking77")!, {
        cacheDir: dir,
        fetchImpl: fakeFetch({}, []),
        retry: { attempts: 2, baseDelayMs: 1 },
      }),
      /Download failed \(404\)/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OOS scoring: abstain wins, then max(ood, 1 - confidence)", () => {
  assert.equal(oosScore(undefined), 1);
  assert.equal(oosScore({ type: "choice", choice: "a", confidence: 0.9, probabilities: {}, abstained: true }), 1);
  assert.equal(oosScore({ type: "choice", choice: "a", confidence: 0.9, probabilities: {}, ood: 0.7 }), 0.7);
  assert.ok(Math.abs(oosScore({ type: "choice", choice: "a", confidence: 0.6, probabilities: {} }) - 0.4) < 1e-9);
});

test("flag rate at 5% FPR and AUROC", () => {
  const inScope = Array.from({ length: 100 }, (_, i) => i / 100); // 0.00 .. 0.99
  const oos = [0.99, 0.97, 0.96, 0.5, 0.1];
  const at = flagRateAtFpr(inScope, oos);
  assert.equal(at.threshold, 0.94); // 5 in-scope scores (0.95..0.99) lie above it
  assert.equal(at.rate, 0.6);
  assert.equal(auroc([0.1, 0.2], [0.8, 0.9]), 1);
  assert.equal(auroc([0.5], [0.5]), 0.5);
  assert.equal(flagRateAtFpr([0.1], []).rate, 0);
});

test("scorePublicTrack reports accuracy, calibration and OOS detection", async () => {
  const spec = specById("clinc150_oos")!;
  const ds = toLoaded(spec, [
    { text: "set a timer for 5 minutes", label: "timer" },
    { text: "weather in paris", label: "weather" },
    { text: "timer please", label: "timer" },
    { text: "how do I bake bread", label: "oos" },
  ]);
  const runner = async (req: SystemOneRequest): Promise<SystemOneResponse | null> => {
    const text = (req.state as { text: string }).text;
    if (text.includes("bake")) {
      return { model: "fake", answers: { label: { type: "choice", choice: "timer", confidence: 0.3, probabilities: {} } }, usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 0 } as SystemOneResponse;
    }
    if (text.includes("weather")) return null; // an error counts as wrong
    return { model: "fake", answers: { label: { type: "choice", choice: "timer", confidence: 0.9, probabilities: {} } }, usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 0 } as SystemOneResponse;
  };
  const row = await scorePublicTrack({ id: "fake", label: "Fake", kind: "local" }, runner, ds, ds.examples);
  assert.equal(row.status, "ok");
  assert.equal(row.n, 3);
  assert.equal(row.errors, 1);
  assert.ok(Math.abs(row.accuracy! - 2 / 3) < 1e-3);
  assert.equal(row.ood?.n, 1);
  assert.equal(row.ood?.flag_rate_at_5_fpr, 0); // the failed in-scope call scores 1, so the threshold is 1
  assert.equal(row.ood?.confident_rate, 0);
  assert.ok(row.ood!.auroc > 0 && row.ood!.auroc < 1);
  // Shipped threshold: the OOS answer carries no `ood`, so it is not flagged;
  // the failed in-scope call counts as a false alarm.
  assert.equal(row.ood?.auroc_ood_field, 0.3333); // no ood field: only the failed in-scope call scores 1
  assert.deepEqual(row.ood?.at_shipped_threshold, {
    threshold: 0.6,
    flag_rate: 0,
    false_positive_rate: 0.3333,
  });
});
