import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildEvalImport, MAX_IMPORT_ROWS, type ImportedCase } from "@/lib/jev/eval-import";
import { ImportError, parseExamples } from "@/lib/jev/label-import";
import type { Questions } from "@/lib/jev/types";
import { JevValidationError, validateRequest } from "@/lib/jev/validate";

type SavedDecision = { id: string; name: string; questions?: Questions };

interface EvalLabelImportProps {
  decisions: SavedDecision[];
  running: boolean;
  onRun: (input: { cases: ImportedCase[]; decisionId: string | null }) => void;
}

const PREVIEW_ROWS = 25;
const labelCls = "font-mono text-[10px] uppercase tracking-[0.14em] text-subtle";

const EXAMPLE_QUESTIONS = `{
  "intent": {
    "type": "choice",
    "instructions": "What does the customer want?",
    "criteria": { "refund": "Wants money back", "status": "Asks where the order is" }
  },
  "urgent": { "type": "noul", "instructions": "Is the customer upset or in a hurry?" }
}`;

const EXAMPLE_CSV = `state,intent,urgent
"I want my money back for these shoes",refund,no
"Where is my package? It has been two weeks!",status,yes`;

function stateText(state: unknown): string {
  const s = typeof state === "string" ? state : JSON.stringify(state);
  return s.length > 90 ? `${s.slice(0, 90)}...` : s;
}

type Schema = { questions: Questions | null; error: string | null };

function parseSchema(source: string, decisions: SavedDecision[], json: string): Schema {
  if (source !== "json") {
    const d = decisions.find((x) => x.id === source);
    if (!d?.questions || Object.keys(d.questions).length === 0) {
      return { questions: null, error: "This decision has no questions saved." };
    }
    return { questions: d.questions, error: null };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { questions: null, error: "Questions must be valid JSON (the map you send to /v1/systemone)." };
  }
  try {
    return { questions: validateRequest({ state: "-", questions: raw }).questions, error: null };
  } catch (err) {
    return { questions: null, error: err instanceof JevValidationError ? err.message : "Invalid questions." };
  }
}

/** CSV / JSONL label import for the evals page: validate against a schema, preview, run. */
export function EvalLabelImport({ decisions, running, onRun }: EvalLabelImportProps) {
  const [source, setSource] = useState<string>(decisions[0]?.id ?? "json");
  const [questionsJson, setQuestionsJson] = useState(EXAMPLE_QUESTIONS);
  const [rows, setRows] = useState(EXAMPLE_CSV);

  const schema = useMemo(() => parseSchema(source, decisions, questionsJson), [source, decisions, questionsJson]);
  const parsed = useMemo(() => {
    if (!schema.questions) return null;
    try {
      return { result: buildEvalImport(parseExamples(rows), schema.questions), error: null };
    } catch (err) {
      return { result: null, error: err instanceof ImportError ? err.message : "Could not read the rows." };
    }
  }, [rows, schema.questions]);

  async function onFile(file: File | undefined) {
    if (file) setRows(await file.text());
  }

  const result = parsed?.result ?? null;
  const canRun = Boolean(result && result.valid > 0) && !running;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <label className={labelCls} htmlFor="import-schema">
            Question schema
          </label>
          <select
            id="import-schema"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-11 w-full rounded-sm bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]"
          >
            {decisions.map((d) => (
              <option key={d.id} value={d.id}>
                Saved decision: {d.name}
              </option>
            ))}
            <option value="json">Paste questions JSON</option>
          </select>
          {source === "json" ? (
            <textarea
              value={questionsJson}
              onChange={(e) => setQuestionsJson(e.target.value)}
              rows={10}
              spellCheck={false}
              aria-label="Questions JSON"
              className="w-full rounded-md bg-inset px-3 py-2 font-mono text-xs"
            />
          ) : null}
          {schema.error ? <p className="text-sm text-danger">{schema.error}</p> : null}
        </div>
        <div className="space-y-1.5">
          <span className={labelCls}>Labelled rows (CSV with a state column, JSONL, or JSON)</span>
          <textarea
            value={rows}
            onChange={(e) => setRows(e.target.value)}
            rows={10}
            spellCheck={false}
            aria-label="Labelled rows"
            className="w-full rounded-md bg-inset px-3 py-2 font-mono text-xs"
          />
          <input
            type="file"
            accept=".csv,.jsonl,.json,text/csv,application/json"
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="text-xs text-muted"
          />
          <p className="text-xs text-muted">
            One column per question id. Choice: an option key. Score: a level index (0 = first level). Noul:
            yes/no or true/false. Empty cells are skipped. Up to {MAX_IMPORT_ROWS} rows.
          </p>
        </div>
      </div>

      {parsed?.error ? <p className="text-sm text-danger">{parsed.error}</p> : null}

      {result ? (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">{result.valid}</span> valid row{result.valid === 1 ? "" : "s"}
            {result.invalid ? (
              <>
                , <span className="text-danger">{result.invalid} with errors (skipped)</span>
              </>
            ) : null}
            {Object.keys(result.perQuestion).length ? (
              <span className="text-muted">
                {" "}
                · labels per question:{" "}
                {Object.entries(result.perQuestion)
                  .map(([q, n]) => `${q} ${n}`)
                  .join(", ")}
              </span>
            ) : null}
          </p>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className={`border-b border-border ${labelCls}`}>
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Labels</th>
                  <th className="px-3 py-2">Check</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {result.rows.slice(0, PREVIEW_ROWS).map((r) => (
                  <tr key={r.row} className="border-b border-border/60">
                    <td className="px-3 py-1.5 tabular-nums text-muted">{r.row}</td>
                    <td className="px-3 py-1.5">{stateText(r.state)}</td>
                    <td className="px-3 py-1.5">
                      {Object.entries(r.labels)
                        .map(([q, v]) => `${q}=${String(v)}`)
                        .join(", ")}
                    </td>
                    <td className={`px-3 py-1.5 ${r.error ? "text-danger" : "text-muted"}`}>{r.error ?? "ok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.rows.length > PREVIEW_ROWS ? (
            <p className="text-xs text-muted">
              Showing the first {PREVIEW_ROWS} of {result.rows.length} rows.
              {result.rows.slice(PREVIEW_ROWS).some((r) => r.error)
                ? ` ${result.rows.slice(PREVIEW_ROWS).filter((r) => r.error).length} more rows below have errors.`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      <Button
        type="button"
        disabled={!canRun}
        onClick={() =>
          result && onRun({ cases: result.cases, decisionId: source === "json" ? null : source })
        }
      >
        {running ? "Running..." : `Run eval on ${result?.valid ?? 0} labelled rows`}
      </Button>
    </div>
  );
}
