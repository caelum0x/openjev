import { OpenJevClient, type Questions, type SystemOneRequest, type SystemOneResult } from "@openjev/sdk";
import { experimental_evaluate, generateText, isStepCount } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { choice, createOpenJev, type DecisionClient, grade, noul, score, summarize } from "./index.js";

type Answers = SystemOneResult<Questions>["answers"];

function fakeClient(answers: Answers, extra: Partial<SystemOneResult<Questions>> = {}) {
  const calls: { request: SystemOneRequest<Questions>; options: unknown }[] = [];
  const client: DecisionClient = {
    systemOne: async (request, options) => {
      calls.push({ request, options });
      return {
        model: request.model ?? "otsone-latest",
        answers,
        usage: { input_tokens: 42, output_tokens: 0 },
        ...extra,
      } as SystemOneResult<Questions>;
    },
  };
  return { client, calls };
}

const toolOptions = { toolCallId: "t1", messages: [], context: {} } as never;

const refund = {
  type: "choice",
  choice: "refund",
  confidence: 0.9,
  probabilities: { refund: 0.9, cancel: 0.1 },
  ood: 0.04,
  calibrated: true,
} as const;

describe("tools", () => {
  it("choiceTool sends one question with abstain on and returns a summary", async () => {
    const { client, calls } = fakeClient({ decision: refund } as unknown as Answers);
    const openjev = createOpenJev({ client, model: "auto", calibrationId: "cal_1" });
    const route = openjev.choiceTool({
      description: "Route a support message",
      instructions: "Main request in `text`?",
      options: { refund: "Wants money back.", cancel: null },
    });

    const out = await route.execute?.({ text: "Please refund me" }, toolOptions);

    expect(out).toEqual({
      type: "choice",
      answer: "refund",
      confidence: 0.9,
      probabilities: { refund: 0.9, cancel: 0.1 },
      abstained: false,
      escalated: false,
      calibrated: true,
      ood: 0.04,
    });
    expect(calls[0]?.request).toEqual({
      state: "Please refund me",
      questions: {
        decision: {
          type: "choice",
          instructions: "Main request in `text`?",
          criteria: { refund: "Wants money back.", cancel: null },
        },
      },
      model: "auto",
      calibration_id: "cal_1",
      abstain: true,
    });
  });

  it("noulTool and scoreTool flatten their answers; per-tool model wins", async () => {
    const { client, calls } = fakeClient({
      decision: { type: "noul", noul: 0.2, escalated: true },
    } as unknown as Answers);
    const openjev = createOpenJev({ client, model: "auto", abstain: false });
    const gate = openjev.noulTool({
      description: "Is it spam?",
      instructions: "Is `text` spam?",
      model: "laya-onnx",
    });
    const out = await gate.execute?.({ text: "hi" }, toolOptions);
    expect(out).toMatchObject({ type: "noul", answer: false, escalated: true });
    expect((out as { confidence: number }).confidence).toBeCloseTo(0.8);
    expect(calls[0]?.request.model).toBe("laya-onnx");
    expect(calls[0]?.request.abstain).toBe(false);

    const scored = fakeClient({
      decision: {
        type: "score",
        score: 1.4,
        confidence: 0.6,
        legend: { 0: "low", 1: "mid", 2: "high" },
        probabilities: { 0: 0.1, 1: 0.4, 2: 0.5 },
      },
    } as unknown as Answers);
    const severity = createOpenJev({ client: scored.client }).scoreTool({
      description: "Severity",
      instructions: "How severe?",
      levels: ["low", "mid", "high"],
    });
    const s = await severity.execute?.({ text: "down" }, toolOptions);
    expect(s).toMatchObject({ type: "score", answer: 1.4, probabilities: { "0": 0.1, "2": 0.5 } });
  });

  it("an abstained answer comes back as null with its reason", async () => {
    const { client } = fakeClient({
      decision: {
        type: "choice",
        choice: "__none__",
        confidence: 0.1,
        probabilities: { refund: 0.05, cancel: 0.05, __none__: 0.9 },
        abstained: true,
        abstain_reason: "out_of_scope",
      },
    } as unknown as Answers);
    const route = createOpenJev({ client }).choiceTool({
      description: "Route",
      instructions: "Intent?",
      options: { refund: null, cancel: null },
    });
    const out = await route.execute?.({ text: "focaccia recipe" }, toolOptions);
    expect(out).toMatchObject({ answer: null, abstained: true, abstain_reason: "out_of_scope" });
  });

  it("decisionTool answers several questions and reports escalations", async () => {
    const { client } = fakeClient(
      { intent: refund, urgent: { type: "noul", noul: 0.95 } } as unknown as Answers,
      { escalation: { local_model: "otsone-1", escalated: ["urgent"], kept: ["intent"], threshold: 0.6, provider: "groq", llm_model: "x" } },
    );
    const triage = createOpenJev({ client }).decisionTool({
      description: "Triage a ticket",
      questions: { intent: choice("Intent?", { refund: null, cancel: null }), urgent: noul("Urgent?") },
    });
    const out = await triage.execute?.({ text: "refund now" }, toolOptions);
    expect(out).toMatchObject({ escalated: ["urgent"], answers: { intent: { answer: "refund" }, urgent: { answer: true } } });
  });

  it("works inside generateText's tool loop", async () => {
    const { client } = fakeClient({ decision: refund } as unknown as Answers);
    const openjev = createOpenJev({ client });
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "route", input: JSON.stringify({ text: "refund me" }) },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      },
    });
    const result = await generateText({
      model,
      prompt: "Route this message",
      tools: {
        route: openjev.choiceTool({
          description: "Route a support message",
          instructions: "Intent?",
          options: { refund: null, cancel: null },
        }),
      },
      stopWhen: isStepCount(1),
    });
    expect(result.toolResults[0]?.output).toMatchObject({ answer: "refund", confidence: 0.9 });
  });
});

describe("evaluator", () => {
  const questions = {
    grounded: noul("Is `output` supported by `input`?"),
    tone: choice("Tone of `output`?", { polite: null, rude: null }),
    quality: score("Quality of `output`?", ["bad", "ok", "good"]),
  };

  it("passes when every expectation holds", async () => {
    const { client, calls } = fakeClient({
      grounded: { type: "noul", noul: 0.9 },
      tone: { type: "choice", choice: "polite", confidence: 0.8, probabilities: { polite: 0.8, rude: 0.2 } },
      quality: { type: "score", score: 1.8, confidence: 0.7, legend: {}, probabilities: { 0: 0, 1: 0.2, 2: 0.8 } },
    } as unknown as Answers);
    const check = createOpenJev({ client }).evaluator({
      questions,
      expect: [
        { id: "grounded", equals: true },
        { id: "tone", oneOf: ["polite"] },
        { id: "quality", atLeast: 1.5 },
      ],
      minConfidence: 0.6,
    });
    const result = await check({ input: "What is 2+2?", output: "4" });
    expect(result).toMatchObject({ pass: true, reasons: [] });
    expect(result.score).toBeCloseTo(0.7);
    expect(calls[0]?.request.state).toEqual({ input: "What is 2+2?", output: "4" });
    expect(calls[0]?.request.abstain).toBe(true);
  });

  it("fails with reasons: wrong value, low confidence, abstained, at most", async () => {
    const { client } = fakeClient({
      grounded: { type: "noul", noul: 0.3 },
      tone: { type: "choice", choice: "polite", confidence: 0.55, probabilities: { polite: 0.55, rude: 0.45 } },
      quality: { type: "score", score: 2, confidence: 0.9, legend: {}, probabilities: { 0: 0, 1: 0, 2: 1 }, abstained: true, abstain_reason: "low_confidence" },
    } as unknown as Answers);
    const check = createOpenJev({ client }).evaluator({
      questions,
      expect: [
        { id: "grounded", equals: true },
        { id: "tone", oneOf: ["polite"] },
        { id: "quality", atMost: 1 },
      ],
      minConfidence: 0.6,
    });
    const result = await check("just output");
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([
      "grounded: expected true, got false",
      "tone: confidence 0.55 below 0.6",
      "quality: abstained (low_confidence)",
    ]);
  });

  it("rejects malformed specs up front", () => {
    const { client } = fakeClient({} as Answers);
    const openjev = createOpenJev({ client });
    expect(() => openjev.evaluator({ questions, expect: [] })).toThrow(/at least one/);
    expect(() => openjev.evaluator({ questions, expect: [{ id: "nope", equals: true }] })).toThrow(/no matching question/);
    expect(() => openjev.evaluator({ questions, expect: [{ id: "tone", oneOf: ["polite"] }], minConfidence: 2 })).toThrow(/between 0 and 1/);
    expect(() => createOpenJev({ client, abstainBelow: -1 })).toThrow(/between 0 and 1/);
  });

  it("grade reports a missing answer", () => {
    expect(grade({}, [{ id: "x", atLeast: 1 }])).toMatchObject({ pass: false, score: 0, reasons: ["x: no answer returned"] });
  });
});

describe("evaluation model (experimental_evaluate)", () => {
  it("maps boolean to Noul and normalises answers to the AI SDK contract", async () => {
    const { client, calls } = fakeClient({
      spam: { type: "noul", noul: 0.12 },
      intent: {
        type: "choice",
        choice: "__none__",
        confidence: 0.2,
        probabilities: { refund: 0.06, cancel: 0.04, __none__: 0.9 },
        abstained: true,
        abstain_reason: "out_of_scope",
        ood: 0.83,
      },
      severity: { type: "score", score: 1.1, confidence: 0.5, legend: {}, probabilities: { 0: 0.2, 1: 0.5, 2: 0.3 }, escalated: true },
    } as unknown as Answers, {
      escalation: { local_model: "otsone-1", escalated: ["severity"], kept: ["spam", "intent"], threshold: 0.6, provider: "groq", llm_model: "x" },
      calibration: { id: "cal_9", method: "temperature", questions: ["intent"] },
    });
    const openjev = createOpenJev({ client, calibrationId: "cal_default" });

    const result = await experimental_evaluate({
      model: openjev("auto"),
      state: "How do I bake focaccia?",
      questions: {
        spam: { type: "boolean", instructions: "Is it spam?" },
        intent: { type: "choice", instructions: "Intent?", criteria: { refund: null, cancel: null } },
        severity: { type: "score", instructions: "Severity?", criteria: ["low", "mid", "high"] },
      },
      providerOptions: { openjev: { abstain: true, calibrationId: "cal_9" } },
    });

    expect(result.answers.spam).toEqual({ type: "boolean", probability: 0.12 });
    expect(result.answers.intent.choice).toBe("refund");
    expect(result.answers.intent.probabilities?.refund).toBeCloseTo(0.6);
    expect(result.answers.severity.score).toBeCloseTo(1.1);

    const meta = result.providerMetadata?.openjev as Record<string, unknown>;
    expect(meta).toMatchObject({
      model: "auto",
      escalated: ["severity"],
      calibration_id: "cal_9",
      answers: { intent: { abstained: true, abstain_reason: "out_of_scope", ood: 0.83 } },
    });
    expect(result.warnings.some((w) => w.type === "other" && /abstained on "intent"/.test(w.message))).toBe(true);

    expect(calls[0]?.request).toMatchObject({
      model: "auto",
      state: "How do I bake focaccia?",
      abstain: true,
      calibration_id: "cal_9",
      questions: { spam: { type: "noul", instructions: "Is it spam?" } },
    });
  });

  it("uses the provider default model and forwards the abort signal", async () => {
    const { client, calls } = fakeClient({ ok: { type: "noul", noul: 0.7 } } as unknown as Answers);
    const controller = new AbortController();
    const model = createOpenJev({ client, model: "laya-onnx" }).evaluationModel();
    expect(model.modelId).toBe("laya-onnx");
    await experimental_evaluate({
      model,
      state: { a: 1 },
      questions: { ok: { type: "boolean", instructions: "ok?" } },
      abortSignal: controller.signal,
    });
    expect((calls[0]?.options as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("real SDK client over HTTP", () => {
  it("posts the merged request to /v1/systemone with the API key", async () => {
    const seen: { url: string; body: unknown; auth: string | null }[] = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      seen.push({ url: input, body: JSON.parse(String(init?.body)), auth: headers.get("authorization") });
      return Response.json({
        model: "auto",
        answers: { decision: { type: "noul", noul: 0.9 } },
        usage: { input_tokens: 3, output_tokens: 0 },
      });
    };
    const openjev = createOpenJev({
      apiKey: "test-key",
      baseURL: "http://openjev.test",
      fetch: fetchImpl,
      model: "auto",
      escalateBelow: 0.7,
    });
    expect(openjev.client).toBeInstanceOf(OpenJevClient);
    const out = await openjev.decide({ state: "x", questions: { decision: noul("ok?") } });
    expect(out.answers.decision?.answer).toBe(true);
    expect(seen[0]?.url).toBe("http://openjev.test/v1/systemone");
    expect(seen[0]?.auth).toBe("Bearer test-key");
    expect(seen[0]?.body).toMatchObject({ model: "auto", escalate_below: 0.7, state: "x" });
    expect((seen[0]?.body as Record<string, unknown>).abstain).toBeUndefined();
  });
});

describe("summarize", () => {
  it("clamps noul and treats __none__ as abstained", () => {
    expect(summarize({ type: "noul", noul: 1.2 } as never)).toMatchObject({ answer: true, confidence: 1 });
    expect(
      summarize({ type: "choice", choice: "__none__", confidence: 0.3, probabilities: {} } as never),
    ).toMatchObject({ answer: null, abstained: true });
  });
});

describe("default provider", () => {
  it("builds its client lazily from OPENJEV_* env vars", async () => {
    const { openjev } = await import("./index.js");
    const prev = process.env.OPENJEV_API_KEY;
    process.env.OPENJEV_API_KEY = "env-key";
    try {
      expect(openjev.client).toBeInstanceOf(OpenJevClient);
      expect(openjev("otsone-1").modelId).toBe("otsone-1");
      expect(typeof openjev.choiceTool).toBe("function");
    } finally {
      if (prev === undefined) delete process.env.OPENJEV_API_KEY;
      else process.env.OPENJEV_API_KEY = prev;
    }
  });
});
