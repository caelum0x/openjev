import { describe, expect, expectTypeOf, it } from "vitest";
import { choice, OpenJevClient, type ShadowResult } from "../src";
import { json, mockFetch } from "./helpers";

const ANSWER = {
  model: "auto",
  answers: {
    intent: {
      type: "choice",
      choice: "__none__",
      confidence: 0.2,
      probabilities: { refund: 0.1, status: 0.1, __none__: 0.8 },
      ood: 0.91,
      abstained: true,
      abstain_reason: "out_of_scope",
      calibrated: true,
    },
  },
  usage: { input_tokens: 3, output_tokens: 0 },
  latency_ms: 4,
  calibration: { id: "cal_abc123", method: "isotonic", questions: ["intent"] },
};

describe("trust-layer request fields", () => {
  it("forwards calibration_id, abstain and the auto model and exposes trust fields", async () => {
    const { fetch, requests } = mockFetch(() => json(ANSWER));
    const client = new OpenJevClient({ apiKey: "k", fetch });
    const r = await client.systemOne({
      model: "auto",
      state: "what is the weather on mars",
      calibration_id: "cal_abc123",
      escalate_below: 0.6,
      questions: {
        intent: { ...choice("Intent?", { refund: null, status: null }), abstain: true },
      },
    });
    expect(requests[0]?.body).toMatchObject({
      model: "auto",
      calibration_id: "cal_abc123",
      escalate_below: 0.6,
    });
    expect(requests[0]?.body).toMatchObject({ questions: { intent: { abstain: true } } });
    expect(r.answers.intent.abstained).toBe(true);
    expect(r.answers.intent.abstain_reason).toBe("out_of_scope");
    expect(r.calibration?.id).toBe("cal_abc123");
    expectTypeOf(r.answers.intent.choice).toEqualTypeOf<"refund" | "status" | "__none__">();
  });
});

describe("shadow resource", () => {
  it("posts to /v1/shadow with the default model and unwraps data", async () => {
    const result = {
      batch_id: "shb_1",
      incumbent: { name: "humans", source: "caller", kind: "label" },
      calibration_id: null,
      ours: ANSWER,
      comparisons: [],
      agreement: 1,
    };
    const { fetch, requests } = mockFetch(() => json({ data: result }));
    const client = new OpenJevClient({ apiKey: "k", fetch, defaultModel: "system-one" });
    const r = await client.shadow.run({
      state: "refund me",
      questions: { intent: choice("Intent?", { refund: null, status: null }) },
      incumbent: { name: "humans", kind: "label", answers: { intent: "refund" } },
    });
    expect(requests[0]?.url).toMatch(/\/v1\/shadow$/);
    expect(requests[0]?.body).toMatchObject({ model: "system-one", incumbent: { kind: "label" } });
    expect(r.batch_id).toBe("shb_1");
    expectTypeOf(r).toMatchTypeOf<ShadowResult>();
  });

  it("builds the summary query string", async () => {
    const { fetch, requests } = mockFetch(() => json({ data: { total: 0 } }));
    const client = new OpenJevClient({ apiKey: "k", fetch });
    await client.shadow.summary({ days: 7, threshold: 0.8 });
    expect(requests[0]?.url).toMatch(/\/v1\/shadow\?days=7&threshold=0\.8$/);
  });

  it("rejects an unexpected envelope", async () => {
    const { fetch } = mockFetch(() => json({ nope: true }));
    const client = new OpenJevClient({ apiKey: "k", fetch });
    await expect(client.shadow.summary()).rejects.toThrow(/expected \{ data/);
  });
});
