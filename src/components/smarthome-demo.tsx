import { useMemo, useState } from "react";
import {
  Blinds,
  Camera,
  Fan,
  Home,
  Lightbulb,
  Lock,
  Plug,
  Send,
  Speaker,
  Split,
  Thermometer,
  Unlock,
} from "lucide-react";
import { AnswerView, TypePill } from "@/components/answer-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/jev/browser";
import { EngineBadge, ThresholdSetNote } from "@/components/engine-badge";
import {
  ROOMS,
  SMARTHOME_EXAMPLES,
  defaultHome,
  type DeviceKind,
  type HomeDevice,
  type HomeState,
  type SmarthomePath,
  type SmarthomeResult,
} from "@/lib/jev/cookbooks/smarthome";
import type { Answer } from "@/lib/jev/types";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; text: string; result?: SmarthomeResult };

const KIND_ICON: Record<DeviceKind, typeof Lightbulb> = {
  lights: Lightbulb,
  thermostat: Thermometer,
  lock: Lock,
  speaker: Speaker,
  blinds: Blinds,
  fan: Fan,
  outlet: Plug,
  camera: Camera,
};

function deviceLine(d: HomeDevice): string {
  if (d.kind === "lights") return d.on ? `${d.brightness ?? 80}%` : "off";
  if (d.kind === "thermostat") return `${d.temperature ?? 20}°`;
  if (d.kind === "lock") return d.locked ? "locked" : "unlocked";
  if (d.kind === "speaker") return d.playing ? "playing" : "idle";
  if (d.kind === "blinds") return d.open ? "open" : "closed";
  if (d.kind === "fan" || d.kind === "outlet") return d.on ? "on" : "off";
  if (d.kind === "camera") return d.on ? "armed" : "disarmed";
  return d.on ? "on" : "off";
}

function isActive(d: HomeDevice): boolean {
  if (d.kind === "lock") return Boolean(d.locked);
  if (d.kind === "speaker") return Boolean(d.playing);
  if (d.kind === "blinds") return Boolean(d.open);
  return d.on;
}

const PATH_LABEL: Record<SmarthomePath, string> = {
  command: "command",
  query: "query",
  conversation: "LLM fallback",
  compound: "compound split",
  scene: "scene",
  blocked: "blocked",
};

export function SmarthomeDemo() {
  const [home, setHome] = useState<HomeState>(() => defaultHome());
  const [utterance, setUtterance] = useState(SMARTHOME_EXAMPLES[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Msg[]>([]);
  const [last, setLast] = useState<SmarthomeResult | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);

  const flash = useMemo(() => {
    const ids = new Set<string>();
    if (!last) return ids;
    for (const step of last.steps) {
      for (const e of step.effects) ids.add(e.id);
    }
    return ids;
  }, [last]);

  async function send(text = utterance) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setLog((m) => [...m, { role: "user", text: q }]);
    try {
      const out = await api<SmarthomeResult>("/api/v1/cookbooks/smarthome", {
        method: "POST",
        body: JSON.stringify({ utterance: q, home }),
      });
      setHome(out.home);
      setLast(out);
      setLog((m) => [...m, { role: "assistant", text: out.reply, result: out }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function resetHouse() {
    const next = defaultHome();
    setHome(next);
    setLast(null);
    setLog([]);
    setShowAnswers(false);
  }

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm leading-relaxed text-muted">
        One TypeSafe call asks every question the house might need — category,
        domain, device, and a speculative action for{" "}
        <span className="text-fg">each</span> device type — then code keeps the
        relevant slice. Compound utterances split; conversation falls through to
        a writer. Sequential calls would wait. This does not.
      </p>

      {last ? <EngineBadge engine={last.engine} model={last.model} /> : null}
      {last ? <ThresholdSetNote thresholds={last.thresholds} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <HousePlan home={home} flash={flash} onReset={resetHouse} />

        <div className="flex min-h-[28rem] flex-col rounded-md bg-surface shadow-[var(--shadow-border)]">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Assistant
            </p>
            {last ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                {PATH_LABEL[last.path]}
              </span>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
            {log.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">
                Try the TypeSafe example: “Turn off all of the lights in the
                house”. The last question is asked before we know it is lights.
              </p>
            ) : (
              log.map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={cn(
                    "max-w-[95%] rounded-md px-3 py-2 text-sm leading-relaxed",
                    m.role === "user"
                      ? "self-end bg-raised text-fg"
                      : "self-start bg-inset text-fg shadow-[var(--shadow-border)]",
                  )}
                >
                  {m.text}
                  {m.result ? (
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                      {PATH_LABEL[m.result.path]} · {m.result.questions_asked} q ·{" "}
                      {m.result.latency_ms} ms
                      {m.result.llm.used ? ` · ${m.result.llm.purpose}` : ""}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border px-3 py-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {SMARTHOME_EXAMPLES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    if (busy) return;
                    setUtterance(c);
                    void send(c);
                  }}
                  disabled={busy}
                  className={cn(
                    "min-h-11 max-w-full rounded-sm px-3 py-2 text-left text-xs leading-snug",
                    utterance === c ? "bg-raised text-fg" : "text-muted hover:text-fg",
                    busy && "opacity-40",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <Input
                value={utterance}
                onChange={(e) => setUtterance(e.target.value)}
                placeholder="Ask the house"
                aria-label="Utterance"
              />
              <Button type="submit" disabled={busy} size="icon" aria-label="Send">
                <Send className="size-4" />
              </Button>
            </form>
            {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
          </div>
        </div>
      </div>

      {last ? (
        <Trace
          result={last}
          showAnswers={showAnswers}
          onToggleAnswers={() => setShowAnswers((v) => !v)}
        />
      ) : null}
    </div>
  );
}

function HousePlan({
  home,
  flash,
  onReset,
}: {
  home: HomeState;
  flash: Set<string>;
  onReset: () => void;
}) {
  return (
    <div className="rounded-md bg-surface shadow-[var(--shadow-border)]">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Home className="size-4 text-muted" />
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            House
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="h-11 px-3 font-mono text-xs text-muted hover:text-fg"
        >
          Reset
        </button>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
        {ROOMS.map((room) => {
          const devices = home.devices.filter((d) => d.room === room.id);
          return (
            <div key={room.id} className="min-h-36 bg-inset p-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                {room.label}
              </p>
              <ul className="space-y-1.5">
                {devices.map((d) => {
                  const Icon =
                    d.kind === "lock" && !d.locked ? Unlock : KIND_ICON[d.kind];
                  const active = isActive(d);
                  const danger = d.kind === "lock" && !d.locked;
                  return (
                    <li
                      key={d.id}
                      className={cn(
                        "flex items-center gap-2 rounded-sm px-1.5 py-1 text-xs transition-colors duration-200",
                        flash.has(d.id) && "bg-raised",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
                          danger ? "text-danger" : active ? "text-ok" : "text-subtle",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-muted">
                        {d.kind}
                      </span>
                      <span
                        className={cn(
                          "font-mono tabular-nums",
                          danger ? "text-danger" : active ? "text-fg" : "text-subtle",
                        )}
                      >
                        {deviceLine(d)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Trace({
  result,
  showAnswers,
  onToggleAnswers,
}: {
  result: SmarthomeResult;
  showAnswers: boolean;
  onToggleAnswers: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Wrong way — serial
          </p>
          <ol className="mt-3 space-y-1.5 text-sm text-muted">
            <li>1. category of request</li>
            <li>2. wait → domain + device</li>
            <li>3. wait → action on that device</li>
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-subtle">
            Optimizes for fewer questions. Slower and more expensive.
          </p>
        </div>
        <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            This call — speculative fan-out
          </p>
          <p className="mt-3 font-mono text-sm text-fg">
            {result.questions_asked} questions · 1 round trip · {result.latency_ms} ms
          </p>
          <p className="mt-2 text-sm text-muted">
            Used {result.used.length} · discarded {result.discarded.length}
            {result.path === "compound" ? ` · split into ${result.splits.length}` : ""}
            {result.llm.used ? ` · writer for ${result.llm.purpose}` : ""}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-subtle">
            Ask lights_action before you know it is lights. Filter in code.
          </p>
        </div>
      </div>

      {result.path === "compound" ? (
        <div className="flex items-start gap-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
          <Split className="mt-0.5 size-4 shrink-0 text-muted" />
          <div className="min-w-0 space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Compound · noul {result.steps[0]?.compound.toFixed(2) ?? result.allow.toFixed(2)}
            </p>
            <ol className="text-sm text-fg">
              {result.splits.map((s, i) => (
                <li key={s}>
                  {i + 1}. {s}
                  {result.steps[i] ? (
                    <span className="ml-2 font-mono text-xs text-muted">
                      {result.steps[i]!.action} {result.steps[i]!.device}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Used
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.used.map((id) => (
            <span
              key={id}
              className="rounded-sm bg-raised px-2 py-1 font-mono text-xs text-fg"
            >
              {id}
            </span>
          ))}
        </div>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Discarded
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.discarded.map((id) => (
            <span
              key={id}
              className="rounded-sm px-2 py-1 font-mono text-xs text-subtle"
            >
              {id}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleAnswers}
        className="h-11 text-sm text-muted hover:text-fg"
      >
        {showAnswers ? "Hide all answers" : "Show all TypeSafe answers"}
      </button>
      {showAnswers ? <AnswerGrid answers={result.answers} /> : null}
    </div>
  );
}

function AnswerGrid({ answers }: { answers: Record<string, Answer> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Object.entries(answers).map(([id, ans]) => (
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
      ))}
    </div>
  );
}
