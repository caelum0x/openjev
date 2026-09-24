/**
 * Parse labelled examples pasted or uploaded in the console (pure, client-safe).
 *
 * Accepted formats:
 *   - JSON array:  [{ "state": ..., "labels": { "<qid>": <label> } }, ...]
 *   - JSONL:       one { "state", "labels" } object per line
 *   - CSV:         header `state,<qid>,<qid>...`; one example per row; the
 *                  state column is text, every other column a label (empty =
 *                  unlabelled for that question). RFC-4180 quoting supported.
 */
export type ParsedExample = { state: unknown; labels: Record<string, unknown> };

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

function asExample(v: unknown, where: string): ParsedExample {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new ImportError(`${where}: expected an object with state and labels.`);
  }
  const o = v as Record<string, unknown>;
  if (o.state === undefined || o.state === null) throw new ImportError(`${where}: missing state.`);
  if (!o.labels || typeof o.labels !== "object" || Array.isArray(o.labels)) {
    throw new ImportError(`${where}: labels must be an object of question id to label.`);
  }
  return { state: o.state, labels: o.labels as Record<string, unknown> };
}

/** Split CSV text into rows of fields (RFC-4180: quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new ImportError("CSV: unterminated quoted field.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export function parseExamples(text: string): ParsedExample[] {
  const t = text.trim();
  if (!t) throw new ImportError("Paste or upload at least one labelled example.");
  if (t.startsWith("[")) {
    let data: unknown;
    try {
      data = JSON.parse(t);
    } catch {
      throw new ImportError("JSON: could not parse the array.");
    }
    if (!Array.isArray(data)) throw new ImportError("JSON: expected an array.");
    return data.map((v, i) => asExample(v, `row ${i + 1}`));
  }
  if (t.startsWith("{")) {
    return t
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((line, i) => {
        try {
          return asExample(JSON.parse(line), `line ${i + 1}`);
        } catch (err) {
          if (err instanceof ImportError) throw err;
          throw new ImportError(`line ${i + 1}: invalid JSON.`);
        }
      });
  }
  const rows = parseCsv(t);
  const header = rows[0]?.map((h) => h.trim()) ?? [];
  const stateCol = header.indexOf("state");
  if (stateCol < 0) throw new ImportError("CSV: header must include a `state` column.");
  const qCols = header.map((h, i) => ({ h, i })).filter(({ i }) => i !== stateCol);
  if (qCols.length === 0) throw new ImportError("CSV: add at least one label column after `state`.");
  return rows.slice(1).map((r, n) => {
    const labels: Record<string, unknown> = {};
    for (const { h, i } of qCols) {
      const v = (r[i] ?? "").trim();
      if (v !== "") labels[h] = v;
    }
    const state = (r[stateCol] ?? "").trim();
    if (!state) throw new ImportError(`CSV row ${n + 2}: empty state.`);
    return { state, labels };
  });
}
