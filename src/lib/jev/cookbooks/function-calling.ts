import { lexicalEvaluator, type Evaluator } from "./evaluator";
import type { ChoiceAnswer, NoulAnswer, Questions } from "../types";

type ArgSpec =
  | {
      kind: "choice";
      question: string;
      stated: string;
      optional: boolean;
      options: Record<string, string>;
    }
  | {
      kind: "flag";
      question: string;
      stated: string;
      optional: boolean;
    }
  | {
      kind: "set";
      question: (member: string) => string;
      members: string[];
    };

type ToolSpec = {
  description: string;
  args: Record<string, ArgSpec>;
};

const SYMBOLS: Record<string, string> = {
  SPY: "S&P 500 ETF",
  NVDA: "NVIDIA",
  AMD: "Advanced Micro Devices",
  AAPL: "Apple",
  MSFT: "Microsoft",
  TSLA: "Tesla",
};

const WINDOWS: Record<string, string> = {
  "1d": "one trading day",
  "1w": "one week",
  "1mo": "one month",
  "3mo": "three months",
};

export const TOOLS: Record<string, ToolSpec> = {
  plot_price: {
    description: "Plot a price chart for a single symbol",
    args: {
      symbol: {
        kind: "choice",
        question: "Which ticker should be plotted?",
        stated: "Does the user name a ticker to chart?",
        optional: false,
        options: SYMBOLS,
      },
      style: {
        kind: "choice",
        question: "Plain line or candles?",
        stated: "Does the user say how the chart should be drawn?",
        optional: true,
        options: {
          line: "a simple close line",
          candles: "candlestick / OHLC bars",
        },
      },
      window: {
        kind: "choice",
        question: "What lookback window?",
        stated: "Does the user say a period such as a week or a month?",
        optional: true,
        options: WINDOWS,
      },
      include_volume: {
        kind: "flag",
        question: "Does the user want volume on the chart?",
        stated: "Is volume mentioned?",
        optional: true,
      },
    },
  },
  rolling_correlation: {
    description: "Plot rolling correlation between a symbol and a benchmark",
    args: {
      symbol: {
        kind: "choice",
        question: "Which ticker is the primary subject — the first named symbol?",
        stated: "Is a primary ticker named?",
        optional: false,
        options: SYMBOLS,
      },
      benchmark: {
        kind: "choice",
        question:
          "Which second ticker or market benchmark (often SPY / S&P 500) is the comparison?",
        stated: "Is a second ticker or index named?",
        optional: false,
        options: {
          SPY: "SPY, the S&P 500 benchmark index, the market",
          NVDA: "NVIDIA as the second name",
          AMD: "AMD as the second name",
          AAPL: "Apple as the second name",
          MSFT: "Microsoft as the second name",
          TSLA: "Tesla as the second name",
        },
      },
      window: {
        kind: "choice",
        question: "Over what window should correlation be computed?",
        stated: "Is a period named (week, month, quarter)?",
        optional: true,
        options: WINDOWS,
      },
    },
  },
  compare_symbols: {
    description: "Overlay several symbols on one chart",
    args: {
      symbols: {
        kind: "set",
        question: (m) => `Should ${m} be included in the comparison?`,
        members: Object.keys(SYMBOLS),
      },
      window: {
        kind: "choice",
        question: "What lookback window for the comparison?",
        stated: "Is a period named?",
        optional: true,
        options: WINDOWS,
      },
    },
  },
  plot_returns: {
    description: "Plot period returns for a symbol",
    args: {
      symbol: {
        kind: "choice",
        question: "Which ticker's returns?",
        stated: "Is a ticker named?",
        optional: false,
        options: SYMBOLS,
      },
      window: {
        kind: "choice",
        question: "Over what window?",
        stated: "Is a period named?",
        optional: true,
        options: WINDOWS,
      },
    },
  },
};

function buildQuestions(): Questions {
  const q: Questions = {
    __tool__: {
      type: "choice",
      instructions: "What is the user asking the trading assistant to do?",
      criteria: Object.fromEntries(
        Object.entries(TOOLS).map(([k, v]) => [k, v.description]),
      ),
    },
  };
  for (const [tool, spec] of Object.entries(TOOLS)) {
    for (const [arg, a] of Object.entries(spec.args)) {
      if (a.kind === "set") {
        for (const m of a.members) {
          q[`${tool}.${arg}.${m}`] = {
            type: "noul",
            instructions: a.question(m),
            criteria: {
              true: `The user wants ${m} included`,
              false: `${m} is not part of the request`,
            },
          };
        }
        continue;
      }
      if (a.optional) {
        q[`${tool}.${arg}?`] = {
          type: "noul",
          instructions: a.stated,
          criteria: {
            true: "The user stated this argument",
            false: "Omit and use the function default",
          },
        };
      }
      if (a.kind === "choice") {
        q[`${tool}.${arg}`] = {
          type: "choice",
          instructions: a.question,
          criteria: a.options,
        };
      } else {
        q[`${tool}.${arg}`] = {
          type: "noul",
          instructions: a.question,
          criteria: { true: "yes", false: "no" },
        };
      }
    }
  }
  return q;
}

export const DISPATCH_QUESTIONS = buildQuestions();

export type BoundArg = {
  value: string | boolean | string[] | null;
  omitted: boolean;
  probability: number;
};

export type DispatchCall = {
  name: string;
  arguments: Record<string, BoundArg>;
  confidence: number;
  weakest: string;
};

export async function dispatchCommand(
  command: string,
  model = "system-one",
  evaluate: Evaluator = lexicalEvaluator,
) {
  const out = await evaluate({ model, state: { command }, questions: DISPATCH_QUESTIONS });
  const toolAns = out.answers.__tool__ as ChoiceAnswer;
  const name = toolAns.choice;
  const spec = TOOLS[name];
  const args: Record<string, BoundArg> = {};
  let worst = toolAns.confidence;
  let weakest = "__tool__";

  if (spec) {
    for (const [arg, a] of Object.entries(spec.args)) {
      if (a.kind === "set") {
        const members: string[] = [];
        let pMin = 1;
        for (const m of a.members) {
          const n = out.answers[`${name}.${arg}.${m}`] as NoulAnswer | undefined;
          const p = n?.noul ?? 0;
          if (p >= 0.55) members.push(m);
          pMin = Math.min(pMin, p >= 0.55 ? p : 1);
        }
        args[arg] = {
          value: members,
          omitted: members.length === 0,
          probability: members.length ? pMin : 0,
        };
        if (pMin < worst) {
          worst = pMin;
          weakest = `${name}.${arg}`;
        }
        continue;
      }
      if (a.optional) {
        const stated = out.answers[`${name}.${arg}?`] as NoulAnswer | undefined;
        if ((stated?.noul ?? 0) < 0.5) {
          args[arg] = { value: null, omitted: true, probability: 1 - (stated?.noul ?? 0) };
          continue;
        }
      }
      if (a.kind === "choice") {
        const c = out.answers[`${name}.${arg}`] as ChoiceAnswer | undefined;
        const p = c ? c.probabilities[c.choice] ?? 0 : 0;
        args[arg] = {
          value: c?.choice ?? null,
          omitted: !c,
          probability: p,
        };
        if ((c?.confidence ?? 1) < worst) {
          worst = c?.confidence ?? 1;
          weakest = `${name}.${arg}`;
        }
      } else {
        const n = out.answers[`${name}.${arg}`] as NoulAnswer | undefined;
        const p = n?.noul ?? 0;
        args[arg] = { value: p >= 0.5, omitted: false, probability: Math.max(p, 1 - p) };
        if (Math.max(p, 1 - p) < worst) {
          worst = Math.max(p, 1 - p);
          weakest = `${name}.${arg}`;
        }
      }
    }

    const mentioned = Object.keys(SYMBOLS)
      .map((s) => ({ s, i: command.toUpperCase().indexOf(s) }))
      .filter((x) => x.i >= 0)
      .sort((a, b) => a.i - b.i)
      .map((x) => x.s);
    if (name === "rolling_correlation" && mentioned.length >= 2) {
      args.symbol = { value: mentioned[0]!, omitted: false, probability: 0.95 };
      args.benchmark = { value: mentioned[1]!, omitted: false, probability: 0.95 };
    } else if (name === "plot_price" && mentioned[0] && args.symbol) {
      args.symbol = { value: mentioned[0], omitted: false, probability: 0.95 };
    }
  }

  const call: DispatchCall = {
    name,
    arguments: args,
    confidence: Math.round(worst * 10000) / 10000,
    weakest,
  };

  return {
    model: out.model,
    engine: out.engine ?? null,
    usage: out.usage,
    latency_ms: out.latency_ms,
    command,
    call,
    questions_asked: Object.keys(DISPATCH_QUESTIONS).length,
    answers: out.answers,
  };
}

export const FUNCTION_META = {
  id: "function-calling",
  title: "Function calling",
  blurb:
    "Natural-language trading requests become calls to ordinary typed functions. Function names and closed-set arguments are TypeSafe questions; code owns the functions.",
  stat: "speculative fan-out",
  href: "/cookbooks/function-calling",
};

export const FUNCTION_EXAMPLES = [
  "plot rolling correlation between nvda and spy for the past month",
  "candles for tesla this week with volume",
  "compare nvda amd and msft over the past three months",
  "is amd tracking nvidia lately",
  "returns for apple last quarter",
];
