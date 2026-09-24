/**
 * @openjev/ai-sdk — OpenJev typed decisions for the Vercel AI SDK.
 *
 * - Evaluation model: `openjev("auto")` (or `.evaluationModel(id)`) plugs into
 *   the AI SDK's `experimental_evaluate`, which has the same shape as System
 *   One: one state, named choice / score / boolean questions.
 * - Tools: `choiceTool`, `scoreTool`, `noulTool` and `decisionTool` wrap
 *   questions as AI SDK tools an agent can call. The model sends the text to
 *   judge; the tool returns the typed answer, its confidence, the distribution,
 *   and whether it abstained or escalated.
 * - Evaluators: `evaluator` grades a generated output against typed questions
 *   (pass/fail with reasons), for guardrails before a reply ships and for eval
 *   suites over `generateText` results.
 * - `decide` is the plain call with the provider's defaults.
 *
 * Model `"auto"` is the local-first cascade: questions the local model is
 * unsure about are re-asked to the server's configured LLM. Abstention and
 * calibration maps are opt-in per provider or per call. All HTTP goes through
 * `@openjev/sdk`; nothing here generates text.
 */
import {
  type ChoiceCriteria,
  choice,
  type ModelId,
  noul,
  OpenJevClient,
  type OpenJevClientConfig,
  type Question,
  type Questions,
  type ScoreCriteria,
  type SystemOneRequest,
  type SystemOneResult,
  score,
} from "@openjev/sdk";
import { jsonSchema, type Tool, tool } from "ai";
import { createEvaluationModel, type EvaluationModelV4, type RunOptions } from "./evaluation-model.js";
import {
  type DecisionOutput,
  type DecisionSummary,
  type Evaluation,
  type Expectation,
  grade,
  toOutput,
} from "./summary.js";

export type { EvaluationModelV4, OpenJevEvaluationOptions } from "./evaluation-model.js";
export {
  type AbstainReason,
  type DecisionOutput,
  type DecisionSummary,
  type Evaluation,
  type Expectation,
  grade,
  NONE_LABEL,
  summarize,
} from "./summary.js";
export { choice, noul, score };

/** Anything with the SDK's `systemOne` shape; lets tests and custom transports plug in. */
export interface DecisionClient {
  systemOne(
    request: SystemOneRequest<Questions>,
    options?: RunOptions,
  ): PromiseLike<SystemOneResult<Questions>>;
}

export interface OpenJevProviderSettings extends OpenJevClientConfig {
  /** Use an existing client instead of building one from the config fields. */
  readonly client?: DecisionClient;
  /** Model for tools, evaluators and `decide`; `"auto"` is the local-first cascade. */
  readonly model?: ModelId;
  /** Calibration map fitted on your labels (`cal_…`). */
  readonly calibrationId?: string;
  /** Let answers abstain ("I don't know"). Tools and evaluators default to `true`. */
  readonly abstain?: boolean;
  /** Confidence floor below which an answer abstains (0-1). */
  readonly abstainBelow?: number;
  /** `auto` only: escalate questions whose local confidence is below this (0-1). */
  readonly escalateBelow?: number;
}

export interface ToolInput {
  /** The text to judge. */
  readonly text: string;
}

interface ToolBase {
  /** What the tool does, written for the calling model. */
  readonly description: string;
  /** Question wording, e.g. "Which team should handle `text`?". */
  readonly instructions: string;
  readonly model?: ModelId;
}

export interface ChoiceToolSpec extends ToolBase {
  /** Labels mapped to descriptions (or `null`). */
  readonly options: ChoiceCriteria;
}

export interface ScoreToolSpec extends ToolBase {
  /** Ordered rubric, one description per level from 0. */
  readonly levels: ScoreCriteria;
}

export type NoulToolSpec = ToolBase;

export interface DecisionToolSpec {
  readonly description: string;
  readonly questions: Questions;
  readonly model?: ModelId;
}

export interface EvaluatorSpec {
  readonly questions: Questions;
  readonly expect: readonly Expectation[];
  /** An answer below this confidence fails the check (default 0). */
  readonly minConfidence?: number;
  readonly model?: ModelId;
}

export interface EvaluationInput {
  /** The generated output to grade. */
  readonly output: string;
  /** The prompt or conversation that produced it, when the questions refer to it. */
  readonly input?: string;
}

export type Evaluator = (input: EvaluationInput | string) => Promise<Evaluation>;

export interface OpenJevProvider {
  /** Shorthand for `evaluationModel(modelId)`. */
  (modelId?: ModelId): EvaluationModelV4;
  readonly client: DecisionClient;
  /** An AI SDK evaluation model for `experimental_evaluate`. */
  evaluationModel(modelId?: ModelId): EvaluationModelV4;
  decide(request: SystemOneRequest<Questions>): Promise<DecisionOutput>;
  choiceTool(spec: ChoiceToolSpec): Tool<ToolInput, DecisionSummary>;
  scoreTool(spec: ScoreToolSpec): Tool<ToolInput, DecisionSummary>;
  noulTool(spec: NoulToolSpec): Tool<ToolInput, DecisionSummary>;
  decisionTool(spec: DecisionToolSpec): Tool<ToolInput, DecisionOutput>;
  evaluator(spec: EvaluatorSpec): Evaluator;
}

/** Model used by `evaluationModel()` when neither the call nor the settings name one. */
export const DEFAULT_EVALUATION_MODEL = "auto";

const TOOL_INPUT = jsonSchema<ToolInput>({
  type: "object",
  properties: { text: { type: "string", minLength: 1, description: "The text to judge." } },
  required: ["text"],
  additionalProperties: false,
});

function assertFraction(name: string, value: number | undefined): void {
  if (value !== undefined && !(value >= 0 && value <= 1)) {
    throw new Error(`\`${name}\` must be between 0 and 1, got ${String(value)}.`);
  }
}

function validateEvaluator(spec: EvaluatorSpec): void {
  if (spec.expect.length === 0) throw new Error("evaluator: `expect` needs at least one check.");
  for (const e of spec.expect) {
    if (!(e.id in spec.questions)) {
      throw new Error(`evaluator: expectation "${e.id}" has no matching question.`);
    }
  }
  assertFraction("minConfidence", spec.minConfidence);
}

const withModel = (m: ModelId | undefined): { model?: ModelId } => (m ? { model: m } : {});

/** Create the provider. Config fields not listed above go to `OpenJevClient`. */
export function createOpenJev(settings: OpenJevProviderSettings = {}): OpenJevProvider {
  const { client: given, model, calibrationId, abstain, abstainBelow, escalateBelow, ...config } =
    settings;
  assertFraction("abstainBelow", abstainBelow);
  assertFraction("escalateBelow", escalateBelow);
  const client: DecisionClient = given ?? new OpenJevClient(config);

  /** Fill provider defaults under the request's own values; drop unset keys. */
  const withDefaults = (
    request: SystemOneRequest<Questions>,
    abstainDefault: boolean | undefined,
  ): SystemOneRequest<Questions> => {
    const merged = {
      ...request,
      model: request.model ?? model,
      calibration_id: request.calibration_id ?? calibrationId,
      abstain: request.abstain ?? abstain ?? abstainDefault,
      abstain_below: request.abstain_below ?? abstainBelow,
      escalate_below: request.escalate_below ?? escalateBelow,
    };
    return Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== undefined),
    ) as unknown as SystemOneRequest<Questions>;
  };

  const run = async (
    request: SystemOneRequest<Questions>,
    abstainDefault?: boolean,
  ): Promise<DecisionOutput> =>
    toOutput(await client.systemOne(withDefaults(request, abstainDefault)));

  const singleQuestionTool = (
    description: string,
    question: Question,
    toolModel: ModelId | undefined,
  ): Tool<ToolInput, DecisionSummary> =>
    tool({
      description,
      inputSchema: TOOL_INPUT,
      execute: async ({ text }: ToolInput): Promise<DecisionSummary> => {
        const out = await run(
          { state: text, questions: { decision: question }, ...withModel(toolModel) },
          true,
        );
        const answer = out.answers.decision;
        if (!answer) throw new Error("OpenJev returned no answer for the decision.");
        return answer;
      },
    });

  const evaluationModel = (modelId?: ModelId): EvaluationModelV4 =>
    createEvaluationModel(modelId ?? model ?? DEFAULT_EVALUATION_MODEL, async (req, options) => {
      // Provider defaults apply unless the call's providerOptions set them.
      const merged = withDefaults(req, undefined);
      return client.systemOne(merged, options);
    });

  const provider = (modelId?: ModelId): EvaluationModelV4 => evaluationModel(modelId);

  return Object.assign(provider, {
    client,
    evaluationModel,
    decide: (request: SystemOneRequest<Questions>) => run(request),
    choiceTool: (spec: ChoiceToolSpec) =>
      singleQuestionTool(spec.description, choice(spec.instructions, spec.options), spec.model),
    scoreTool: (spec: ScoreToolSpec) =>
      singleQuestionTool(spec.description, score(spec.instructions, spec.levels), spec.model),
    noulTool: (spec: NoulToolSpec) =>
      singleQuestionTool(spec.description, noul(spec.instructions), spec.model),
    decisionTool: (spec: DecisionToolSpec): Tool<ToolInput, DecisionOutput> =>
      tool({
        description: spec.description,
        inputSchema: TOOL_INPUT,
        execute: ({ text }: ToolInput): Promise<DecisionOutput> =>
          run({ state: text, questions: spec.questions, ...withModel(spec.model) }, true),
      }),
    evaluator: (spec: EvaluatorSpec): Evaluator => {
      validateEvaluator(spec);
      return async (input) => {
        const { output, input: prompt } = typeof input === "string" ? { output: input } : input;
        const state: Record<string, string> =
          prompt === undefined ? { output } : { input: prompt, output };
        const out = await run(
          { state, questions: spec.questions, ...withModel(spec.model) },
          true,
        );
        return grade(out.answers, spec.expect, spec.minConfidence ?? 0);
      };
    },
  });
}

/**
 * Default provider, configured from `OPENJEV_API_KEY` / `OPENJEV_BASE_URL`.
 * The client is built on first use, so importing this module never throws.
 */
export const openjev: OpenJevProvider = (() => {
  let instance: OpenJevProvider | undefined;
  const get = (): OpenJevProvider => {
    instance ??= createOpenJev();
    return instance;
  };
  const lazy = (modelId?: ModelId): EvaluationModelV4 => get()(modelId);
  const methods = [
    "evaluationModel",
    "decide",
    "choiceTool",
    "scoreTool",
    "noulTool",
    "decisionTool",
    "evaluator",
  ] as const;
  for (const name of methods) {
    Object.defineProperty(lazy, name, {
      value: (...args: unknown[]) => (get()[name] as (...a: unknown[]) => unknown)(...args),
    });
  }
  Object.defineProperty(lazy, "client", { get: () => get().client });
  return lazy as OpenJevProvider;
})();
