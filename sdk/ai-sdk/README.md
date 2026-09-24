# @openjev/ai-sdk

OpenJev typed decisions for the [Vercel AI SDK](https://ai-sdk.dev): Choice, Score and
Noul as an evaluation model, as tools an agent can call, and as evaluators that grade
generated output. Every answer carries a confidence, the full distribution, and whether it
abstained ("I don't know") or was escalated to an LLM by the `auto` cascade.

Nothing here generates text. Decisions are answered by an OpenJev server, either your own
(Apache-2.0, self-hosted) or the hosted endpoint.

> Not published to npm yet: build `sdk/js` and `sdk/ai-sdk` from a clone of this
> repository and install them by path (`npm install /path/to/openjev/sdk/ai-sdk`).
> The published form will be:

```bash
npm install @openjev/ai-sdk @openjev/sdk ai
export OPENJEV_BASE_URL=http://localhost:8080   # your OpenJev server
export OPENJEV_API_KEY=...                      # a key from its /keys page
```

## Evaluation model

AI SDK 7 ships `experimental_evaluate`, which has the same shape as System One: one state,
named `choice` / `score` / `boolean` questions. OpenJev plugs straight in.

```ts
import { experimental_evaluate as evaluate } from "ai";
import { openjev } from "@openjev/ai-sdk";

const { answers, providerMetadata } = await evaluate({
  model: openjev("auto"),            // local first, LLM only for unsure questions
  state: ticketText,
  questions: {
    intent: { type: "choice", instructions: "Main request?", criteria: { refund: null, cancel: null } },
    urgent: { type: "boolean", instructions: "Does it need a reply today?" },
  },
  providerOptions: { openjev: { abstain: true, calibrationId: "cal_support_v3" } },
});

answers.intent.choice;                       // "refund"
providerMetadata?.openjev.answers.intent;    // { confidence, abstained, abstain_reason, ood, escalated, calibrated }
```

The AI SDK requires a Choice answer to name one of your options, so when OpenJev abstains
the answer is its best real option, `abstained: true` is set in `providerMetadata.openjev`,
and a warning is added. Check it before acting on the answer.

## Tools

```ts
import { generateText } from "ai";
import { openjev } from "@openjev/ai-sdk";

const route = openjev.choiceTool({
  description: "Decide which team handles a support message.",
  instructions: "Which team should handle `text`?",
  options: { billing: "Charges and invoices.", tech: "Bugs and outages.", sales: null },
});

const { toolResults } = await generateText({ model, prompt, tools: { route } });
// { type: "choice", answer: "billing", confidence: 0.91, probabilities: {...},
//   abstained: false, escalated: false, calibrated: false, ood: 0.04 }
```

`scoreTool` (rubric levels), `noulTool` (yes/no) and `decisionTool` (several questions in
one call) work the same way. Tools opt into abstention by default, so a message that fits
no option returns `answer: null` with an `abstain_reason` instead of a guess.

## Evaluators

Grade a generated reply before it ships, or score an eval set:

```ts
const check = openjev.evaluator({
  questions: {
    grounded: noul("Is `output` fully supported by `input`?"),
    tone: choice("Tone of `output`?", { polite: null, rude: null }),
  },
  expect: [{ id: "grounded", equals: true }, { id: "tone", oneOf: ["polite"] }],
  minConfidence: 0.7,
});

const result = await check({ input: question, output: draft });
if (!result.pass) console.warn(result.reasons); // ["grounded: expected true, got false"]
```

Expectations: `equals` (Noul), `oneOf` (Choice), `atLeast` / `atMost` (Score). An abstained
or low-confidence answer fails with a reason, so an unsure grader never passes silently.

## Configuration

```ts
import { createOpenJev } from "@openjev/ai-sdk";

const openjev = createOpenJev({
  baseURL: "https://openjev.internal",
  apiKey: process.env.OPENJEV_API_KEY,
  model: "auto",              // or otsone-1, laya-onnx, laya-mlx, system-one
  calibrationId: "cal_...",   // map fitted on your labels (POST /v1/calibrations)
  abstainBelow: 0.4,          // abstain under this confidence
  escalateBelow: 0.6,         // auto: re-ask the LLM under this confidence
});
```

Any other `OpenJevClient` option (`timeout`, `retry`, `fetch`, `defaultHeaders`) is passed
through, or pass `client` to reuse one.

## Develop

```bash
npm install
npm test          # vitest, no network
npm run typecheck
npm run build
```

MIT licensed.
