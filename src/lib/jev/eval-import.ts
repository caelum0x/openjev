/**
 * Turn imported labelled rows (CSV / JSONL / JSON, see label-import.ts) into
 * eval cases for a question schema (pure, client-safe).
 *
 * Every row is validated against the schema: each label column must be a
 * question in the schema and each value a valid label for that question type
 * (choice key, score level index, noul yes/no). Valid rows become eval cases
 * whose expectations mirror how `answerValue` reads an answer:
 *   - choice  label k      -> the answer's choice must be k
 *   - noul    true / false -> noul >= 0.5 / noul < 0.5
 *   - score   level i      -> round(score) == i  (score in [i - 0.5, i + 0.5))
 * Invalid rows are reported with a row number and reason and are never run.
 */
import type { GoldExpect } from "./gold/types.ts";
import { LabelError, normalizeLabel, type LabelValue } from "./labels.ts";
import type { ParsedExample } from "./label-import.ts";
import type { Questions, State } from "./types.ts";

/** Most rows a single eval run accepts from an import. */
export const MAX_IMPORT_ROWS = 2000;

/** Largest value strictly below `x` that the score/noul bands can express. */
const JUST_BELOW = 1e-6;

export type ImportedRow = {
  /** 1-based row number in the source (data rows, header excluded). */
  row: number;
  state: unknown;
  labels: Record<string, LabelValue>;
  error: string | null;
};

export type ImportedCase = {
  name: string;
  state: State;
  questions: Questions;
  expect: GoldExpect[];
};

export type EvalImport = {
  rows: ImportedRow[];
  cases: ImportedCase[];
  valid: number;
  invalid: number;
  /** Labelled count per question id across valid rows. */
  perQuestion: Record<string, number>;
};

function expectationFor(qid: string, value: LabelValue, questions: Questions): GoldExpect {
  const q = questions[qid]!;
  if (q.type === "choice") return { choice: { id: qid, value: String(value) } };
  if (q.type === "score") {
    const level = Number(value);
    return { score: { id: qid, min: level - 0.5, max: level + 0.5 - JUST_BELOW } };
  }
  return value === true
    ? { noul: { id: qid, min: 0.5 } }
    : { noul: { id: qid, max: 0.5 - JUST_BELOW } };
}

function isState(v: unknown): v is State {
  return (typeof v === "string" && v.trim() !== "") || (typeof v === "object" && v !== null);
}

/** Validate parsed rows against `questions` and build eval cases from the valid ones. */
export function buildEvalImport(examples: readonly ParsedExample[], questions: Questions): EvalImport {
  const rows: ImportedRow[] = [];
  const cases: ImportedCase[] = [];
  const perQuestion: Record<string, number> = {};
  const limited = examples.slice(0, MAX_IMPORT_ROWS);
  limited.forEach((ex, i) => {
    const row = i + 1;
    const labels: Record<string, LabelValue> = {};
    let error: string | null = null;
    if (!isState(ex.state)) error = "empty state";
    for (const [qid, raw] of Object.entries(ex.labels)) {
      if (error) break;
      const q = questions[qid];
      if (!q) {
        error = `"${qid}" is not a question in this schema`;
        break;
      }
      try {
        labels[qid] = normalizeLabel(qid, q, raw);
      } catch (err) {
        error = err instanceof LabelError ? err.message : "invalid label";
      }
    }
    if (!error && Object.keys(labels).length === 0) error = "no labels on this row";
    rows.push({ row, state: ex.state, labels: error ? {} : labels, error });
    if (error) return;
    for (const qid of Object.keys(labels)) perQuestion[qid] = (perQuestion[qid] ?? 0) + 1;
    cases.push({
      name: `row ${row}`,
      state: ex.state as State,
      questions,
      expect: Object.entries(labels).map(([qid, v]) => expectationFor(qid, v, questions)),
    });
  });
  if (examples.length > MAX_IMPORT_ROWS) {
    rows.push({
      row: MAX_IMPORT_ROWS + 1,
      state: "",
      labels: {},
      error: `only the first ${MAX_IMPORT_ROWS} rows are imported (${examples.length} given)`,
    });
  }
  return {
    rows,
    cases,
    valid: cases.length,
    invalid: rows.filter((r) => r.error).length,
    perQuestion,
  };
}
