/**
 * Trace compaction: score every tool call in an agent trace with one noul
 * ("keep verbatim?") blended with how much unique information the call adds,
 * and drop the rest.
 *
 * The noul is answered by an `Evaluator`. POST /api/v1/compact passes the
 * server's real serving path, so it runs on the default System One engine
 * (the sentence-embedding engine when installed, lexical otherwise) and the
 * response says which engine answered. Tests and offline scripts use the
 * deterministic in-process lexical engine.
 */
import { lexicalEvaluator, type Evaluator } from "./cookbooks/evaluator.ts";
import {
  approxTokens,
  type NoulAnswer,
  type Question,
  type SystemOneEngine,
  type SystemOneResponse,
} from "./types.ts";

export type TraceCall = {
  id: string;
  tool: string;
  args: string;
  result: string;
};

export type DroppedCall = {
  call: TraceCall;
  keep: number;
  reason: string;
};

export type CompactResult = {
  kept: TraceCall[];
  dropped: DroppedCall[];
  tokens_before: number;
  tokens_after: number;
  saved_ratio: number;
  /** Model that answered the keep questions. */
  model: string;
  /** Engine that answered (null when the backend does not report one). */
  engine: SystemOneEngine | null;
  /** Decision tokens and wall time spent on the keep questions. */
  usage: SystemOneResponse["usage"];
  latency_ms: number;
};

export const DEFAULT_COMPACT_THRESHOLD = 0.45;

export type CompactOptions = {
  threshold?: number;
  model?: string;
  evaluate?: Evaluator;
};

export const SAMPLE_TRACE: TraceCall[] = [
  {
    id: "1",
    tool: "list_dir",
    args: '{"path":"."}',
    result:
      "src/, tests/, README.md, package.json, node_modules/, dist/, .git/",
  },
  {
    id: "2",
    tool: "grep",
    args: '{"pattern":"TODO"}',
    result: "src/legacy.ts:12: // TODO: delete this file",
  },
  {
    id: "3",
    tool: "read_file",
    args: '{"path":"package.json"}',
    result: '{"name":"app","scripts":{"test":"vitest"}}',
  },
  {
    id: "4",
    tool: "read_file",
    args: '{"path":"src/auth.ts"}',
    result:
      "export function createSession(user) { return cookie(user.id, { httpOnly: true }) }",
  },
  {
    id: "5",
    tool: "run_tests",
    args: '{"file":"src/auth.test.ts"}',
    result: "FAIL expected session cookie, received 401 Unauthorized",
  },
  {
    id: "6",
    tool: "grep",
    args: '{"pattern":"TODO"}',
    result: "src/legacy.ts:12: // TODO: delete this file",
  },
  {
    id: "7",
    tool: "web_search",
    args: '{"query":"best italian restaurants nearby"}',
    result: "Trattoria Roma, 4.6 stars, 12 minutes away",
  },
  {
    id: "8",
    tool: "read_file",
    args: '{"path":"src/auth.ts"}',
    result:
      "export function createSession(user) { return cookie(user.id, { httpOnly: true }) }",
  },
];

function uniqueness(call: TraceCall, others: TraceCall[]): number {
  const sig = `${call.tool}::${call.args}::${call.result}`.slice(0, 400);
  const toks = tokenizeSet(call.result + " " + call.tool + " " + call.args);
  if (toks.size === 0) return 0;
  const other = new Set<string>();
  for (const o of others) {
    const os = `${o.tool}::${o.args}::${o.result}`.slice(0, 400);
    if (os === sig) continue;
    for (const t of tokenizeSet(o.result + " " + o.tool + " " + o.args)) {
      other.add(t);
    }
  }
  let uniq = 0;
  for (const t of toks) if (!other.has(t)) uniq += 1;
  return uniq / toks.size;
}

function tokenizeSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
}

function isDuplicate(call: TraceCall, kept: TraceCall[]): boolean {
  const sig = `${call.tool}::${call.args}::${call.result}`.slice(0, 400);
  return kept.some(
    (k) => `${k.tool}::${k.args}::${k.result}`.slice(0, 400) === sig,
  );
}

const KEEP_QUESTION: Question = {
  type: "noul",
  instructions: "Should this tool result be kept verbatim for later reasoning?",
  criteria: {
    true: "Unique, on-task, and likely needed: test failures, source of the bug, auth, schema",
    false: "Duplicate, unused listing, off-topic search, or boilerplate",
  },
};

const callTokens = (c: TraceCall) => approxTokens(`${c.tool} ${c.args} ${c.result}`);

export async function compactTrace(
  calls: TraceCall[],
  opts: CompactOptions = {},
): Promise<CompactResult> {
  const threshold = opts.threshold ?? DEFAULT_COMPACT_THRESHOLD;
  const model = opts.model ?? "system-one";
  const evaluate = opts.evaluate ?? lexicalEvaluator;
  const tokens_before = calls.reduce((n, c) => n + callTokens(c), 0);
  const dropped: DroppedCall[] = [];
  const kept: TraceCall[] = [];
  const trace_summary = calls.map((c) => `${c.tool} ${c.args}`);
  let answeredBy: Pick<SystemOneResponse, "model" | "engine"> | null = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  let latency = 0;

  for (const [i, call] of calls.entries()) {
    const others = calls.filter((_, j) => j !== i);
    const uniq = uniqueness(call, others);
    const dup = isDuplicate(call, [...kept, ...calls.slice(0, i)]);
    const res = await evaluate({
      model,
      state: {
        call,
        later_tools: calls.slice(i + 1).map((c) => c.tool),
        trace_summary,
      },
      questions: { keep: KEEP_QUESTION },
    });
    answeredBy ??= res;
    usage = {
      input_tokens: usage.input_tokens + res.usage.input_tokens,
      output_tokens: usage.output_tokens + res.usage.output_tokens,
    };
    latency += res.latency_ms;
    const noul = (res.answers.keep as NoulAnswer | undefined)?.noul ?? 0.5;
    const keepScore = dup ? 0.08 : 0.5 * noul + 0.5 * uniq;
    const offTopic =
      /restaurant|weather|lottery|prize/i.test(call.result) ||
      /restaurant|weather/i.test(call.args);
    const finalKeep = offTopic ? Math.min(keepScore, 0.18) : keepScore;
    if (finalKeep < threshold) {
      let reason = "Below keep threshold";
      if (dup) reason = "Duplicate of an earlier call";
      else if (offTopic) reason = "Off-task result";
      else if (uniq < 0.2) reason = "Information already present elsewhere";
      dropped.push({ call, keep: round(finalKeep), reason });
    } else {
      kept.push(call);
    }
  }

  const tokens_after = kept.reduce((n, c) => n + callTokens(c), 0);
  return {
    kept,
    dropped,
    tokens_before,
    tokens_after,
    saved_ratio:
      tokens_before === 0
        ? 0
        : Math.round((1 - tokens_after / tokens_before) * 1000) / 1000,
    model: answeredBy?.model ?? model,
    engine: answeredBy?.engine ?? null,
    usage,
    latency_ms: Math.round(latency * 10) / 10,
  };
}

function round(x: number) {
  return Math.round(x * 1000) / 1000;
}
