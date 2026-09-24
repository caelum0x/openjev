import { stateProse, type EntryType, type State } from "./types.ts";

const POS_KEYS = new Set([
  "what",
  "summary",
  "description",
  "question",
  "focus",
  "signals",
  "examples",
  "for",
  "note",
  "compare",
  "inspect",
  "field",
]);

const NEG_KEYS = new Set(["not_for", "not", "avoid", "except", "exclude"]);

const PATH_KEYS = new Set(["inspect", "compare", "field", "path"]);

export type Flattened = {
  text: string;
  positive: string;
  negative: string;
  examples: string[];
  question: string;
  paths: string[];
};

const EMPTY: Flattened = {
  text: "",
  positive: "",
  negative: "",
  examples: [],
  question: "",
  paths: [],
};

export function flattenEntry(value: EntryType | undefined): Flattened {
  if (value == null) return { ...EMPTY };
  if (typeof value === "string") {
    return {
      text: value,
      positive: value,
      negative: "",
      examples: [],
      question: value,
      paths: extractBackticks(value),
    };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    const s = String(value);
    return { text: s, positive: s, negative: "", examples: [], question: s, paths: [] };
  }
  const pos: string[] = [];
  const neg: string[] = [];
  const examples: string[] = [];
  const paths: string[] = [];
  let question = "";

  walk(value, pos, neg, examples, paths, (q) => {
    if (!question) question = q;
  });

  const positive = pos.filter(Boolean).join(" \n ");
  const negative = neg.filter(Boolean).join(" \n ");
  const text = [positive, negative].filter(Boolean).join(" \n ");
  paths.push(...extractBackticks(text));
  return {
    text,
    positive,
    negative,
    examples,
    question: question || positive,
    paths: unique(paths),
  };
}

function walk(
  value: EntryType,
  pos: string[],
  neg: string[],
  examples: string[],
  paths: string[],
  onQuestion: (q: string) => void,
  keyHint = "",
): void {
  if (value == null) return;
  if (typeof value === "string") {
    if (NEG_KEYS.has(keyHint)) neg.push(value);
    else pos.push(value);
    if (keyHint === "question") onQuestion(value);
    if (keyHint === "examples") examples.push(value);
    paths.push(...extractBackticks(value));
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    pos.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    if (keyHint === "examples" || keyHint === "signals") {
      for (const v of value) {
        if (typeof v === "string") examples.push(v);
        else walk(v, pos, neg, examples, paths, onQuestion, keyHint);
      }
      return;
    }
    if (keyHint === "compare") {
      for (const v of value) {
        if (typeof v === "string") {
          paths.push(stripTicks(v));
          pos.push(v);
        }
      }
      return;
    }
    for (const v of value) walk(v, pos, neg, examples, paths, onQuestion, keyHint);
    return;
  }

  for (const [k, v] of Object.entries(value)) {
    if (v == null) continue;
    if (k === "name" && typeof v === "string") {
      paths.push(v);
      pos.push(v.replace(/_/g, " "));
      continue;
    }
    if (PATH_KEYS.has(k) && typeof v === "string") {
      paths.push(stripTicks(v));
    }
    walk(v as EntryType, pos, neg, examples, paths, onQuestion, k);
  }
}

export function extractBackticks(text: string): string[] {
  const out: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

export function stripTicks(s: string): string {
  return s.replace(/`/g, "").trim();
}

export function getByPath(state: unknown, path: string): unknown {
  const clean = stripTicks(path);
  const parts = clean.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = state;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(p);
      cur = Number.isInteger(i) ? cur[i] : undefined;
      continue;
    }
    if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
      continue;
    }
    return undefined;
  }
  return cur;
}

export function focusedState(state: State, paths: string[]): string {
  const full = stateProse(state);
  const uniquePaths = unique(paths.map(stripTicks).filter(Boolean));
  if (uniquePaths.length === 0) return full;
  const slices: string[] = [];
  for (const p of uniquePaths) {
    const v = getByPath(state, p);
    if (v === undefined) continue;
    slices.push(`${p.replace(/[._]/g, " ")}: ${stateProse(v)}`);
  }
  if (slices.length === 0) return full;
  return `${slices.join("\n")}\n\n${full}`;
}

function unique(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
