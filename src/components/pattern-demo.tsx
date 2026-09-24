import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { AnswerView, TypePill } from "@/components/answer-view";
import { api } from "@/lib/jev/browser";
import { EngineBadge } from "@/components/engine-badge";
import type { PatternCookbook } from "@/lib/jev/cookbooks/patterns";
import type { SystemOneResponse } from "@/lib/jev/types";

export function PatternDemo({ pattern }: { pattern: PatternCookbook }) {
  const [raw, setRaw] = useState(() => JSON.stringify(pattern.state, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<SystemOneResponse | null>(null);
  const [decision, setDecision] = useState<{ label: string; detail: string } | null>(
    null,
  );

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const state = JSON.parse(raw) as unknown;
      const res = await api<SystemOneResponse>("/api/v1/systemone", {
        method: "POST",
        body: JSON.stringify({
          model: "system-one",
          state,
          questions: pattern.questions,
        }),
      });
      setOut(res);
      setDecision(pattern.combine(res.answers));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-subtle">
          State
        </p>
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          className="min-h-[280px] font-mono text-[13px] leading-relaxed"
        />
        <Button type="button" onClick={() => void run()} disabled={busy}>
          {busy ? "Judging…" : "Run System One"}
        </Button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </section>
      <section className="space-y-3">
        {out ? <EngineBadge engine={out.engine} model={out.model} /> : null}
        {decision ? (
          <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Code decides
            </p>
            <p className="mt-1 font-mono text-lg tracking-tight">{decision.label}</p>
            <p className="mt-1 text-sm text-muted">{decision.detail}</p>
          </div>
        ) : (
          <div className="rounded-md bg-surface px-4 py-8 text-sm text-muted shadow-[var(--shadow-border)]">
            Run the batch. Answers are typed; your code combines them.
          </div>
        )}
        {out
          ? Object.entries(out.answers).map(([id, ans]) => (
              <div
                key={id}
                className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-mono text-xs">{id}</p>
                  <TypePill type={ans.type} />
                </div>
                <AnswerView answer={ans} />
              </div>
            ))
          : null}
      </section>
    </div>
  );
}
