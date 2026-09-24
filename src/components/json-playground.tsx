import { useEffect, useMemo, useState } from "react";
import { PLAY_EXAMPLES } from "@/lib/jev/examples";
import {
  DEFAULT_MODEL,
  type BackendStatusResponse,
  type ModelAvailability,
} from "@/lib/jev/models";
import { api } from "@/lib/jev/browser";
import type { SystemOneResponse } from "@/lib/jev/types";
import { AnswerView, TypePill } from "./answer-view";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";
import { ModelPills, type AvailabilityMap } from "./model-pills";
import { CopyButton } from "./copy-button";
import { EngineBadge, ServingEngineNote } from "./engine-badge";
import { cn } from "@/lib/utils";

function examplePayload(id: string, model: string) {
  const ex = PLAY_EXAMPLES.find((e) => e.id === id) ?? PLAY_EXAMPLES[0]!;
  return {
    model,
    state: ex.state,
    questions: ex.questions,
  };
}

export function JsonPlayground() {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [exampleId, setExampleId] = useState(PLAY_EXAMPLES[0]!.id);
  const [raw, setRaw] = useState(() =>
    JSON.stringify(examplePayload(PLAY_EXAMPLES[0]!.id, DEFAULT_MODEL), null, 2),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<SystemOneResponse | null>(null);
  const [tab, setTab] = useState<"json" | "answers">("answers");
  const [availability, setAvailability] = useState<AvailabilityMap>({});

  // Probe which backends are actually installed on this deployment so the model
  // selector can disable ones that would silently fall back to the local engine
  // (e.g. a Laya sidecar that is not running). Best-effort: on failure we leave
  // the map empty and every model stays selectable.
  useEffect(() => {
    let cancelled = false;
    api<BackendStatusResponse>("/api/v1/status")
      .then((status) => {
        if (cancelled) return;
        const map: AvailabilityMap = {};
        for (const m of status.models) map[m.id] = m;
        setAvailability(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedStatus: ModelAvailability | undefined = availability[model];
  const selectedUnavailable = selectedStatus
    ? !selectedStatus.available
    : false;

  function loadExample(id: string, nextModel = model) {
    setExampleId(id);
    setRaw(JSON.stringify(examplePayload(id, nextModel), null, 2));
    setError(null);
  }

  function changeModel(id: string) {
    setModel(id);
    try {
      const parsed = JSON.parse(raw) as { model?: string };
      parsed.model = id;
      setRaw(JSON.stringify(parsed, null, 2));
    } catch {
      loadExample(exampleId, id);
    }
  }

  const curl = useMemo(() => {
    return `curl /api/v1/systemone \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer $OPENJEV_API_KEY' \\
  -d '${raw.replace(/'/g, "'\\''")}'`;
  }, [raw]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const payload = JSON.parse(raw) as unknown;
      const res = await api<SystemOneResponse>("/api/v1/systemone", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setOut(res);
      setTab("answers");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <ModelPills
          value={model}
          onChange={changeModel}
          includeEscalation
          availability={availability}
        />
        <div className="flex flex-wrap gap-1.5">
          {PLAY_EXAMPLES.map((ex) => (
            <button
              key={ex.id}
              type="button"
              onClick={() => loadExample(ex.id)}
              className={cn(
                "h-11 rounded-sm px-3 text-xs transition-colors duration-150",
                exampleId === ex.id
                  ? "bg-raised text-fg"
                  : "text-muted hover:text-fg",
              )}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      <ServingEngineNote />

      {selectedUnavailable ? (
        <p className="rounded-sm bg-inset px-3 py-2 text-xs leading-relaxed text-muted">
          <span className="font-mono text-fg">{model}</span> is not installed on
          this deployment
          {selectedStatus?.install ? ` — ${selectedStatus.install}` : "."} Until
          then it will answer from the local engine.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-subtle">
              Request
            </p>
            <CopyButton text={raw} label="Copy JSON" />
          </div>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            spellCheck={false}
            className="min-h-[420px] font-mono text-[13px] leading-relaxed"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={run} disabled={busy}>
              {busy ? "Running…" : "Run"}
            </Button>
            <CopyButton text={curl} label="Copy curl" />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-subtle">
              Response
            </p>
            {out ? (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setTab("answers")}
                  className={cn(
                    "h-9 rounded-sm px-3 text-xs",
                    tab === "answers" ? "bg-raised text-fg" : "text-muted",
                  )}
                >
                  Answers
                </button>
                <button
                  type="button"
                  onClick={() => setTab("json")}
                  className={cn(
                    "h-9 rounded-sm px-3 text-xs",
                    tab === "json" ? "bg-raised text-fg" : "text-muted",
                  )}
                >
                  JSON
                </button>
              </div>
            ) : null}
          </div>

          {!out ? (
            <div className="flex min-h-[420px] items-center rounded-md bg-surface px-4 py-8 text-sm text-muted shadow-[var(--shadow-border)]">
              Run a request. Answers come back under the same keys — no parsing.
            </div>
          ) : tab === "json" ? (
            <pre className="min-h-[420px] overflow-auto rounded-md bg-surface p-4 font-mono text-[12px] leading-relaxed text-fg shadow-[var(--shadow-border)]">
              {JSON.stringify(out, null, 2)}
            </pre>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <EngineBadge engine={out.engine} model={out.model} />
                <p className="font-mono text-xs text-subtle">
                  {out.model} · {out.usage.input_tokens}+{out.usage.output_tokens} tok ·{" "}
                  {out.latency_ms} ms
                </p>
              </div>
              {out.fallback ? (
                <p className="rounded-sm bg-inset px-3 py-2 text-xs leading-relaxed text-danger">
                  Fell back to{" "}
                  <span className="font-mono">{out.fallback.served}</span>:{" "}
                  <span className="font-mono">{out.fallback.requested}</span> is
                  unavailable. {out.fallback.detail}
                </p>
              ) : null}
              {Object.entries(out.answers).map(([id, ans]) => (
                <div
                  key={id}
                  className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-sm">{id}</p>
                    <TypePill type={ans.type} />
                  </div>
                  <AnswerView answer={ans} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
