/**
 * Router -> gate -> judge agent loop. Each stage is one typed System One call
 * answered by an `Evaluator`: POST /api/v1/loop passes the server's serving
 * path (the embedding engine when installed, lexical otherwise); tests and
 * offline scripts use the in-process lexical engine. The result names the
 * engine that answered.
 */
import { lexicalEvaluator, type Evaluator } from "./cookbooks/evaluator.ts";
import type {
  Answer,
  ChoiceAnswer,
  NoulAnswer,
  ScoreAnswer,
  SystemOneEngine,
  SystemOneResponse,
} from "./types.ts";

export type LoopStage = "router" | "gate" | "judge";

export type LoopStep = {
  stage: LoopStage;
  title: string;
  detail: string;
  answers: Record<string, Answer>;
  allowed: boolean;
  action?: string;
};

export type LoopResult = {
  steps: LoopStep[];
  resolution: string;
  /** Model that answered the stage questions. */
  model: string;
  /** Engine that answered (null when the backend does not report one). */
  engine: SystemOneEngine | null;
  usage: SystemOneResponse["usage"];
  latency_ms: number;
};

export type LoopOptions = { model?: string; evaluate?: Evaluator };

const POLICY = `Do not run destructive tools. Do not refund without a billing match. Prefer reading code and tests before writing. Escalate to a human if risk is high.`;

export async function runAgentLoop(goal: string, opts: LoopOptions = {}): Promise<LoopResult> {
  const model = opts.model ?? "system-one";
  const evaluate = opts.evaluate ?? lexicalEvaluator;
  const calls: SystemOneResponse[] = [];
  const ask = async (req: Omit<Parameters<Evaluator>[0], "model">) => {
    const out = await evaluate({ ...req, model });
    calls.push(out);
    return out;
  };
  const finish = (steps: LoopStep[], resolution: string): LoopResult => ({
    steps,
    resolution,
    model: calls[0]?.model ?? model,
    engine: calls[0]?.engine ?? null,
    usage: calls.reduce(
      (u, c) => ({
        input_tokens: u.input_tokens + c.usage.input_tokens,
        output_tokens: u.output_tokens + c.usage.output_tokens,
      }),
      { input_tokens: 0, output_tokens: 0 },
    ),
    latency_ms: Math.round(calls.reduce((n, c) => n + c.latency_ms, 0) * 10) / 10,
  });

  const router = await ask({
    state: { goal, policy: POLICY, tools: TOOLS },
    questions: {
      tool: {
        type: "choice",
        instructions: "Which tool should run next?",
        criteria: {
          read_file: "Inspect source related to the goal",
          run_tests: "Reproduce a failing test",
          refund_customer: "Issue a payment refund",
          deploy_prod: "Ship the current build to production",
          search_web: "Look up something external",
        },
      },
      needs_human: {
        type: "noul",
        instructions: "Does this need a human before the tool runs?",
        criteria: {
          true: "Refunds, production deploys, legal, or unclear intent",
          false: "Routine engineering: read, test, search",
        },
      },
    },
  });

  const tool = (router.answers.tool as ChoiceAnswer).choice;
  const needsHuman = (router.answers.needs_human as NoulAnswer).noul;
  const routerAllowed = needsHuman < 0.5;

  const steps: LoopStep[] = [
    {
      stage: "router",
      title: "Router",
      detail: "Picks the cheap next action. Not a writing task.",
      answers: router.answers,
      allowed: routerAllowed,
      action: tool,
    },
  ];

  const proposed = proposeCall(tool, goal);
  const gate = await ask({
    state: { goal, policy: POLICY, proposed },
    questions: {
      allow: {
        type: "noul",
        instructions: "Should the gate allow this tool call to run?",
        criteria: {
          true: "Matches policy, reversible, on-task",
          false: "Destructive, off-policy, or needs a human",
        },
      },
      risk: {
        type: "score",
        instructions: "How risky is this tool call?",
        criteria: [
          "Read-only and cheap",
          "Writes local files or runs tests",
          "Touches money or accounts",
          "Irreversible production change",
        ],
      },
    },
  });

  const allow = (gate.answers.allow as NoulAnswer).noul;
  const risk = gate.answers.risk as ScoreAnswer;
  const gateAllowed = allow >= 0.55 && risk.score < 2.2;

  steps.push({
    stage: "gate",
    title: "Gate",
    detail: "Checks the tool call before it runs. Threshold on confidence.",
    answers: gate.answers,
    allowed: gateAllowed,
    action: proposed,
  });

  if (!gateAllowed) {
    return finish(
      steps,
      allow < 0.55
        ? "Gate blocked the call. Escalate or pick another tool."
        : "Risk too high for an unsupervised run.",
    );
  }

  const observation = simulate(tool, goal);
  const judge = await ask({
    state: { goal, tool, observation },
    questions: {
      resolved: {
        type: "noul",
        instructions: "Did this observation make progress on the goal?",
        criteria: {
          true: "New, on-task evidence that unblocks the next step",
          false: "No useful signal, wrong tool, or empty result",
        },
      },
      next: {
        type: "choice",
        instructions: "What should happen after this observation?",
        criteria: {
          continue: "Run another cheap tool",
          write_fix: "The agent has enough to edit code",
          ask_human: "A person needs to decide",
          stop: "The goal is done",
        },
      },
    },
  });

  steps.push({
    stage: "judge",
    title: "Judge",
    detail: "Verifies the output after the tool. Keep survivors verbatim.",
    answers: judge.answers,
    allowed: true,
    action: observation,
  });

  const next = (judge.answers.next as ChoiceAnswer).choice;
  const resolved = (judge.answers.resolved as NoulAnswer).noul;
  const resolution =
    next === "write_fix"
      ? "Judge: enough signal to write a fix. Do not summarize the observation — keep it."
      : next === "ask_human"
        ? "Judge: hand this to a human."
        : resolved > 0.7
          ? "Judge: progress. Continue the loop with the cheap model."
          : "Judge: weak signal. Try a different tool.";

  return finish(steps, resolution);
}

const TOOLS = [
  "read_file",
  "run_tests",
  "refund_customer",
  "deploy_prod",
  "search_web",
];

function proposeCall(tool: string, goal: string): string {
  if (tool === "read_file") return `read_file path=src/auth.ts  // goal: ${goal}`;
  if (tool === "run_tests") return `run_tests file=src/auth.test.ts`;
  if (tool === "refund_customer") return `refund_customer amount=full`;
  if (tool === "deploy_prod") return `deploy_prod env=production`;
  return `search_web q=${JSON.stringify(goal)}`;
}

function simulate(tool: string, goal: string): string {
  if (tool === "read_file") {
    return `// src/auth.ts\nexport function createSession(user) {\n  return cookie(user.id, { httpOnly: true });\n}\n// related to: ${goal}`;
  }
  if (tool === "run_tests") {
    return "FAIL src/auth.test.ts: expected session cookie, received 401";
  }
  if (tool === "search_web") {
    return "MDN: Set-Cookie; HttpOnly; SameSite=Lax";
  }
  return `ran ${tool}`;
}

export const LOOP_PRESETS = [
  {
    id: "login",
    label: "Failing login test",
    goal: "Fix the failing login test in src/auth.test.ts — 401 instead of a session cookie.",
  },
  {
    id: "refund",
    label: "Refund request",
    goal: "Customer was charged twice for order A-104 and wants a full refund issued now.",
  },
  {
    id: "deploy",
    label: "Ship to prod",
    goal: "Deploy the current main branch to production immediately.",
  },
];
