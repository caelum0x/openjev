/**
 * Integration pages for the first-party bridge packages: the Vercel AI SDK
 * provider (sdk/ai-sdk) and the Instructor bridge (adapters/python). Kept apart
 * from integrations.ts so that file stays readable; INTEGRATIONS spreads these in.
 */
import type { Integration } from "./integrations";

const UPDATED = "2026-09-24";

export const PACKAGE_INTEGRATIONS: readonly Integration[] = [
  {
    slug: "ai-sdk-provider",
    title: "@openjev/ai-sdk: an OpenJev provider for the Vercel AI SDK",
    navLabel: "AI SDK provider",
    kind: "js-ts",
    category: "Vercel AI SDK",
    description:
      "Use OpenJev as an AI SDK evaluation model, as agent tools, and as evaluators for generated output, with confidence, abstain and the auto cascade on every answer.",
    keywords: [
      "ai sdk evaluation model",
      "experimental_evaluate",
      "vercel ai sdk classification tool",
      "ai sdk llm evaluator",
      "openjev ai sdk provider",
    ],
    intro:
      '@openjev/ai-sdk connects OpenJev to the Vercel AI SDK in three ways. openjev("auto") is an evaluation model for experimental_evaluate. choiceTool, scoreTool, noulTool and decisionTool are tools an agent can call. evaluator grades a generated reply against typed questions. Every answer comes back with its confidence and distribution, and with whether it abstained or was escalated to an LLM.',
    takeaways: [
      'experimental_evaluate has the same shape as System One, so openjev("auto") is a drop-in evaluation model.',
      "Trust signals (confidence, abstained, ood, escalated, calibrated) are returned in providerMetadata.openjev.",
      "Tools opt into abstention by default, so an agent gets answer: null instead of a confident guess on off-topic input.",
      "Evaluators fail on abstained or low-confidence answers, so an unsure grader never passes a reply silently.",
    ],
    sections: [
      {
        heading: "Install",
        code: {
          lang: "bash",
          code: `# Not on npm yet: install from a clone of the repo
npm install ./openjev/sdk/js ./openjev/sdk/ai-sdk ai
export OPENJEV_BASE_URL=http://localhost:8080
export OPENJEV_API_KEY=<key from your server's /keys page>`,
        },
      },
      {
        heading: "Evaluation model",
        body: "Pass providerOptions.openjev to turn on abstention or apply a calibration map for one call.",
        code: {
          lang: "ts",
          code: `import { experimental_evaluate as evaluate } from "ai";
import { openjev } from "@openjev/ai-sdk";

const { answers, providerMetadata } = await evaluate({
  model: openjev("auto"),
  state: ticketText,
  questions: {
    intent: { type: "choice", instructions: "Main request?",
              criteria: { refund: null, cancel: null } },
    urgent: { type: "boolean", instructions: "Needs a reply today?" },
  },
  providerOptions: { openjev: { abstain: true, calibrationId: "cal_support_v3" } },
});

const trust = providerMetadata?.openjev.answers.intent; // confidence, abstained, ood, ...`,
        },
      },
      {
        heading: "Agent tools",
        code: {
          lang: "ts",
          code: `import { generateText } from "ai";
import { openjev } from "@openjev/ai-sdk";

const route = openjev.choiceTool({
  description: "Decide which team handles a support message.",
  instructions: "Which team should handle \`text\`?",
  options: { billing: "Charges and invoices.", tech: "Bugs and outages.", sales: null },
});

const { toolResults } = await generateText({ model, prompt, tools: { route } });
// { answer: "billing", confidence: 0.91, abstained: false, escalated: false, ... }`,
        },
      },
      {
        heading: "Evaluators for generated output",
        code: {
          lang: "ts",
          code: `import { openjev, noul } from "@openjev/ai-sdk";

const check = openjev.evaluator({
  questions: { grounded: noul("Is \`output\` fully supported by \`input\`?") },
  expect: [{ id: "grounded", equals: true }],
  minConfidence: 0.7,
});

const { pass, reasons } = await check({ input: question, output: draft });`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "The AI SDK requires a Choice answer to name a real option. When OpenJev abstains, the answer is its best option and abstained: true is in providerMetadata.openjev, plus a warning. Check it before acting.",
          'Model "auto" only escalates when the server has an LLM provider configured; otherwise the escalation report says why it was skipped.',
          "Tools and evaluators default to abstain: true. Set abstain: false on createOpenJev for the classic always-answer behaviour.",
        ],
      },
    ],
    faqs: [
      {
        q: "Which AI SDK version does this need?",
        a: "Tools and evaluators work with AI SDK 5 and later. The evaluation model needs AI SDK 7, which added experimental_evaluate.",
      },
      {
        q: "Does it work against a self-hosted server?",
        a: "Yes. Set OPENJEV_BASE_URL to your server, or pass baseURL to createOpenJev. The package only talks to /v1/systemone.",
      },
    ],
    related: [
      { kind: "guide", slug: "jev-out-of-scope-inputs", label: "Why abstain matters" },
      { kind: "guide", slug: "is-jev-calibrated", label: "Is Jev calibrated?" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
      { kind: "compare", slug: "vs-not-diamond", label: "openjev vs Not Diamond" },
    ],
    updated: UPDATED,
  },
  {
    slug: "instructor",
    title: "openjev with Instructor: confidence for every response_model field",
    navLabel: "Instructor",
    kind: "python",
    category: "Instructor",
    description:
      "Keep your Pydantic response_model and get a confidence, a full distribution and an abstain flag for every Literal, bool and bounded int field.",
    keywords: [
      "instructor confidence",
      "instructor response_model",
      "pydantic literal classification confidence",
      "instructor openjev",
      "python llm classification abstain",
    ],
    intro:
      "The openjev-adapters Instructor bridge reads the same Pydantic model you pass to Instructor, answers its decision fields through OpenJev, and returns the validated instance plus a report with the confidence behind every field. Literal and Enum fields become Choice questions, bool becomes Noul, bounded int becomes Score.",
    takeaways: [
      "Call shape mirrors Instructor: client.chat.completions.create(response_model=..., messages=...).",
      "create_with_confidence returns (model, report); report.below(0.8) lists the fields to review.",
      "Optional fields abstain to None; a required field that abstains raises AbstainedError instead of guessing.",
      "Free-text fields are refused with a clear error, so extraction stays with Instructor.",
    ],
    sections: [
      {
        heading: "Install",
        code: {
          lang: "bash",
          code: `# Not on PyPI yet: install from a clone of the repo
pip install ./openjev/adapters/python
export OPENJEV_BASE_URL=http://localhost:8080
export OPENJEV_API_KEY=<key>`,
        },
      },
      {
        heading: "Full example",
        code: {
          lang: "python",
          code: `from typing import Literal
from pydantic import BaseModel, Field
from openjev_adapters.instructor import from_openjev

class Ticket(BaseModel):
    category: Literal["refund", "cancel", "billing"] = Field(description="Main request")
    urgent: bool
    severity: int = Field(ge=0, le=3)
    topic: Literal["shipping", "account"] | None = None

client = from_openjev()
ticket, report = client.chat.completions.create_with_confidence(
    response_model=Ticket,
    messages=[{"role": "user", "content": text}],
    model="auto",
)

if report.below(0.8) or report.any_abstained:
    send_to_review(ticket, report)
else:
    apply(ticket)`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "System messages are treated as LLM instructions and are not part of the judged text.",
          "Score fields need both bounds (ge/gt and le/lt) and 2 to 10 levels.",
          'Add option or level descriptions with Field(json_schema_extra={"options": {...}}) or {"levels": [...]}.',
        ],
      },
    ],
    faqs: [
      {
        q: "Do I need the instructor package installed?",
        a: "No. The bridge only depends on pydantic and the openjev SDK; it copies Instructor's call shape so code reads the same.",
      },
      {
        q: "Is there an async client?",
        a: "Yes: from_openjev_async() returns the same API with await.",
      },
    ],
    related: [
      {
        kind: "guide",
        slug: "instructor-confidence-in-3-lines",
        label: "Add confidence to Instructor in 3 lines",
      },
      { kind: "compare", slug: "vs-instructor", label: "openjev vs Instructor" },
      { kind: "guide", slug: "is-jev-calibrated", label: "Is Jev calibrated?" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
    ],
    updated: UPDATED,
  },
];
