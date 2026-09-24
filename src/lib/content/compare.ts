/**
 * COMPARISONS — honest, factual comparisons between OpenJev (System One,
 * typed Choice / Score / Noul) and the common alternatives people reach for when
 * they need structured judgments out of natural language.
 *
 * These are not marketing hit-pieces. Each entry names where the alternative is
 * the right tool, because for a lot of jobs it is. OpenJev wins on
 * calibrated confidence, closed answer sets, and full probability distributions;
 * it loses whenever you actually need generated prose, open-ended extraction, or
 * hard structural guarantees on arbitrary JSON.
 */

import { MEASURED_LATENCY as ML } from "@/lib/content/benchmarks";
import { TRUST_COMPARISONS } from "./compare-trust";
import type { ProofLink } from "./proof-links";

export type Edge = "openjev" | "other" | "even";

export interface CompareRow {
  dimension: string;
  openjev: string;
  other: string;
  edge: Edge;
}

export interface CodePair {
  otherLabel: string;
  other: string;
  otsLabel: string;
  ots: string;
}

export interface Comparison {
  slug: string;
  /** Full page title, e.g. "openjev vs raw LLM JSON mode". */
  title: string;
  /** Sidebar / card label, e.g. "vs JSON mode". */
  navLabel: string;
  /** What the alternative actually is. */
  otherLabel: string;
  otherBlurb: string;
  /** One-line honest positioning. */
  tagline: string;
  /** Two-to-three sentence honest summary. */
  summary: string;
  rows: CompareRow[];
  /** When the alternative is the correct pick. */
  whenOther: string[];
  /** When OpenJev is the correct pick. */
  whenOts: string[];
  code?: CodePair;
  /** In-app pages that back the OpenJev side of the claims (leaderboard, calibrations, shadow). */
  proof?: readonly ProofLink[];
}

export const COMPARISONS: ReadonlyArray<Comparison> = [
  {
    slug: "vs-raw-llm",
    title: "openjev vs a raw LLM prompt",
    navLabel: "vs raw LLM",
    otherLabel: "Raw LLM prompt-and-parse",
    otherBlurb:
      "Send a prompt, read back prose (or ask for JSON in the prose), then regex or JSON.parse the answer in your code.",
    tagline: "The baseline everyone starts with — and the one OpenJev replaces for decisions.",
    summary:
      "A raw LLM call is the most flexible thing you can do: it writes, reasons, and explains. But when all you wanted was a decision — is this a refund request, which of these five buckets, how severe on a 0–5 scale — you pay for generated tokens, parse free-form output, and get a point answer with no calibrated confidence. OpenJev keeps the language understanding and drops the writing: you declare the answer space up front and get back a typed judgment plus a probability distribution your code can gate on.",
    rows: [
      {
        dimension: "Output shape",
        openjev: "Typed Choice / Score / Noul, always valid",
        other: "Free-form text you parse and hope holds",
        edge: "openjev",
      },
      {
        dimension: "Answer set",
        openjev: "Closed: you enumerate the options (2–255 choices, 2–10 score levels)",
        other: "Open: the model can return anything, including new labels",
        edge: "openjev",
      },
      {
        dimension: "Confidence",
        openjev: "Calibrated 0–1 confidence + full distribution",
        other: "None, unless you prompt for a self-reported number (uncalibrated)",
        edge: "openjev",
      },
      {
        dimension: "Determinism",
        openjev: "Stable — same state and questions give the same judgment",
        other: "Sampling variance run to run; temperature 0 only mitigates it",
        edge: "openjev",
      },
      {
        dimension: "Cost / latency",
        openjev: "Near-zero output tokens; local backends answer in ms",
        other: "Pays for prompt + generated tokens on every call",
        edge: "openjev",
      },
      {
        dimension: "Writing & reasoning prose",
        openjev: "Cannot — it never generates text",
        other: "This is exactly what it is for",
        edge: "other",
      },
      {
        dimension: "Open-ended extraction",
        openjev: "Needs a declared field/question per value",
        other: "Can pull unknown structure from messy input",
        edge: "other",
      },
    ],
    whenOther: [
      "You need a written reply, a summary, code, or a chain of reasoning.",
      "The output shape is genuinely open-ended and you cannot enumerate it.",
      "One-off exploration where flexibility beats structure.",
    ],
    whenOts: [
      "The output is one of a known set of options, a yes/no, or a rubric level.",
      "You want a calibrated confidence to gate on (act / confirm / escalate).",
      "The step runs at volume and you care about cost, latency, and stability.",
    ],
    code: {
      otherLabel: "Raw LLM",
      other: `const res = await llm.chat({
  messages: [{
    role: "user",
    content:
      "Is this a refund request? Reply only 'yes' or 'no'.\\n" + ticket,
  }],
});
// Now parse. Sometimes it says "Yes.", "yes,", or a paragraph.
const yes = /^\\s*yes/i.test(res.choices[0].message.content);
// No confidence. No distribution. Re-runs can flip.`,
      otsLabel: "openjev",
      ots: `const { answers } = await client.systemOne({
  model: "system-one",
  state: { ticket },
  questions: {
    refund: noul("Does \\\`ticket\\\` request a refund?"),
  },
});
// answers.refund.noul is calibrated P(yes) in [0,1].
if (answers.refund.noul >= 0.7) startRefund();`,
    },
  },
  {
    slug: "vs-json-mode",
    title: "openjev vs LLM JSON mode",
    navLabel: "vs JSON mode",
    otherLabel: "LLM JSON / structured-output mode",
    otherBlurb:
      "Provider JSON mode or a JSON schema constrains the model to emit syntactically valid JSON matching a shape you supply.",
    tagline: "JSON mode guarantees the brackets parse. It does not guarantee the judgment is calibrated.",
    summary:
      "JSON mode and schema-constrained decoding solve a real problem: the output parses and matches your fields. That is genuinely useful for extraction and tool arguments. But a schema constrains structure, not meaning — an enum field is still filled by ungrounded next-token sampling, with no probability behind the choice and no calibrated confidence. OpenJev is narrower on purpose: for the decision fields (which bucket, how severe, yes/no) it returns a distribution over the closed set and a confidence you can threshold, instead of a single value that merely happens to be valid.",
    rows: [
      {
        dimension: "Valid structure",
        openjev: "Always valid typed answers",
        other: "Always valid JSON matching the schema",
        edge: "even",
      },
      {
        dimension: "Per-field confidence",
        openjev: "Calibrated confidence on every Choice / Score",
        other: "None — an enum value is just the sampled token",
        edge: "openjev",
      },
      {
        dimension: "Distribution",
        openjev: "Full probability mass over the options",
        other: "Single value, no runner-up probabilities",
        edge: "openjev",
      },
      {
        dimension: "Closed enums",
        openjev: "Contrastive over the declared set, honors not_for",
        other: "Enum in schema, but no contrast between options",
        edge: "openjev",
      },
      {
        dimension: "Nested / free-text fields",
        openjev: "Not the job — one typed question per value",
        other: "Handles arbitrary nested objects and strings",
        edge: "other",
      },
      {
        dimension: "Extraction of unknown values",
        openjev: "Requires you to name each field",
        other: "Pulls names, dates, amounts from raw text",
        edge: "other",
      },
      {
        dimension: "Cost / latency",
        openjev: "Near-zero output tokens; local ms-latency backends",
        other: "Generates the whole JSON payload as tokens",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You are extracting arbitrary structured data (names, line items, nested objects) from text.",
      "You need the output to feed a tool/function call with many free-form fields.",
      "The value cannot be enumerated ahead of time.",
    ],
    whenOts: [
      "The fields that matter are classifications, ratings, or yes/no gates.",
      "You want to route on confidence, not just read a value.",
      "You want the runner-up options and their probabilities, not one guess.",
    ],
    code: {
      otherLabel: "JSON mode",
      other: `const res = await llm.chat({
  response_format: { type: "json_schema", json_schema: {
    name: "triage",
    schema: { type: "object", properties: {
      category: { enum: ["refund","rebooking","info"] },
    }, required: ["category"] },
  }},
  messages: [{ role: "user", content: ticket }],
});
const { category } = JSON.parse(res.choices[0].message.content);
// Valid JSON. But no P(category), no confidence to gate on.`,
      otsLabel: "openjev",
      ots: `const { answers } = await client.systemOne({
  state: { ticket },
  questions: {
    category: choice("Main request in \\\`ticket\\\`?", {
      refund: "Wants money returned.",
      rebooking: "Wants a replacement flight.",
      info: "Asking for information only.",
    }),
  },
});
const c = answers.category; // { choice, probabilities, confidence }
if (c.confidence < 0.5) escalate(); else route(c.choice);`,
    },
  },
  {
    slug: "vs-instructor",
    title: "openjev vs Instructor / Pydantic-style parsing",
    navLabel: "vs Instructor",
    otherLabel: "Instructor / Zod / Pydantic extraction",
    otherBlurb:
      "Libraries like Instructor, Outlines, or Zod-based helpers wrap an LLM: you declare a model/schema, they coerce the response into it and retry on validation failure.",
    tagline: "A great typed wrapper around generation — still generation underneath.",
    summary:
      "Instructor-style libraries are excellent developer ergonomics: define a class, get a validated object, automatic retries when the model drifts. If your job is turning prose into a typed record, reach for one. What they do not add is calibration — a validated field is still the model's single sampled answer, and retries fix shape, not correctness. OpenJev overlaps only on the decision-shaped fields: instead of validating one guessed enum, it returns the distribution over the enum and a confidence you can branch on. Many teams use both — Instructor to extract the record, OpenJev to judge and route it.",
    rows: [
      {
        dimension: "Typed result",
        openjev: "Typed Choice / Score / Noul",
        other: "Typed object from your schema/class",
        edge: "even",
      },
      {
        dimension: "Validation & retries",
        openjev: "Answers are valid by construction — no retry loop",
        other: "Validates then re-prompts on failure (extra calls)",
        edge: "openjev",
      },
      {
        dimension: "Calibrated confidence",
        openjev: "Yes, per decision",
        other: "No — validation checks shape, not certainty",
        edge: "openjev",
      },
      {
        dimension: "Distributions",
        openjev: "Full mass over options / score levels",
        other: "Single coerced value",
        edge: "openjev",
      },
      {
        dimension: "Rich object extraction",
        openjev: "Not the job",
        other: "Core strength — nested models, lists, optionals",
        edge: "other",
      },
      {
        dimension: "Backend",
        openjev: "Local engine / open-weight Laya / any LLM",
        other: "Always a generative LLM call",
        edge: "openjev",
      },
      {
        dimension: "Cost per call",
        openjev: "Near-zero output tokens on local backends",
        other: "Generation tokens + retry tokens",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You are parsing prose into a rich typed object with many fields.",
      "You want automatic re-prompting until the shape validates.",
      "The values are extracted content, not decisions over a known set.",
    ],
    whenOts: [
      "The field is a classification, rating, or boolean gate.",
      "You want a confidence and a distribution, not a coerced single value.",
      "You want to run the step locally with no per-call generation cost.",
    ],
    code: {
      otherLabel: "Instructor-style",
      other: `class Triage(BaseModel):
    category: Literal["refund", "rebooking", "info"]

triage = client.chat.completions.create(
    model="gpt-4o",
    response_model=Triage,   # validate + retry on failure
    messages=[{"role": "user", "content": ticket}],
)
# triage.category is valid. No probability, no confidence.`,
      otsLabel: "openjev",
      ots: `out = openjev.ask(
    state={"ticket": ticket},
    questions={
        "category": Choice("Main request?", {
            "refund": "Wants money returned.",
            "rebooking": "Wants a replacement flight.",
            "info": "Asking for information only.",
        }),
    },
)
c = out["answers"]["category"]  # choice, probabilities, confidence
if c["confidence"] < 0.5: escalate()`,
    },
  },
  {
    slug: "vs-guardrails",
    title: "openjev vs Guardrails / validation layers",
    navLabel: "vs Guardrails",
    otherLabel: "Guardrails / output-validation frameworks",
    otherBlurb:
      "Frameworks like Guardrails AI or NeMo Guardrails wrap an LLM with validators and correction: they check outputs against rules (formats, toxicity, PII, policy) and re-ask or fix when a check fails.",
    tagline: "Guardrails police an LLM's output. OpenJev is a different primitive you can use inside one.",
    summary:
      "Guardrails frameworks sit around a generative model and enforce rules on what it produces — reject, rewrite, or retry until the output passes. That is orthogonal to what OpenJev does: it is not a policy wrapper, it is the decision primitive. In fact a common pattern is to use OpenJev as the validator inside a guardrail — 'does this reply leak PII', 'is this on-policy', scored as calibrated nouls your code thresholds — instead of another prose LLM grading prose. Guardrails give you a control loop; OpenJev gives you a cheap, calibrated, deterministic judgment to drive it.",
    rows: [
      {
        dimension: "Primary role",
        openjev: "Produce a typed judgment",
        other: "Enforce rules on another model's output",
        edge: "even",
      },
      {
        dimension: "The check itself",
        openjev: "Calibrated noul/score you threshold in code",
        other: "Often a regex, classifier, or a second LLM grading prose",
        edge: "openjev",
      },
      {
        dimension: "Determinism of the check",
        openjev: "Stable, reproducible per input",
        other: "LLM-based validators inherit sampling variance",
        edge: "openjev",
      },
      {
        dimension: "Correction / re-ask loop",
        openjev: "Not provided — you own the control flow",
        other: "Built-in: reject, fix, or retry the generation",
        edge: "other",
      },
      {
        dimension: "Policy catalog & integrations",
        openjev: "Bring your own questions",
        other: "Ships prebuilt validators (PII, toxicity, formats)",
        edge: "other",
      },
      {
        dimension: "Cost of a check at volume",
        openjev: "Near-zero on local backends",
        other: "A full LLM call per LLM-based validator",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You need a full control loop that rejects or rewrites a model's output.",
      "You want a library of ready-made validators and policy integrations.",
      "You are wrapping a generative pipeline end to end.",
    ],
    whenOts: [
      "You want the check itself to be a cheap, calibrated, deterministic judgment.",
      "You are replacing an 'LLM grades LLM' validator with a typed one.",
      "You want the same primitive for routing, ranking, and verification, not just guarding.",
    ],
    code: {
      otherLabel: "LLM-as-validator",
      other: `// A guardrail whose check is another prose LLM call
const verdict = await llm.chat({
  messages: [{ role: "user", content:
    "Does this reply leak PII? Answer yes/no.\\n" + reply }],
});
const leaks = /yes/i.test(verdict.choices[0].message.content);
// Another generation. Variance, cost, and no confidence.`,
      otsLabel: "openjev as the check",
      ots: `const { answers } = await client.systemOne({
  state: { reply },
  questions: {
    pii: noul("Does \\\`reply\\\` contain personal data (email, phone, address)?"),
    on_policy: noul("Does \\\`reply\\\` follow the refund policy?"),
  },
});
if (answers.pii.noul > 0.3 || answers.on_policy.noul < 0.7) block();`,
    },
  },
  {
    slug: "vs-openai-structured-outputs",
    title: "openjev vs OpenAI Structured Outputs",
    navLabel: "vs Structured Outputs",
    otherLabel: "OpenAI Structured Outputs",
    otherBlurb:
      "OpenAI's Structured Outputs constrains the model to a JSON Schema you supply (including strict enums), guaranteeing the response conforms to the shape you asked for.",
    tagline:
      "Structured Outputs guarantees your JSON Schema is obeyed. It does not put a probability behind the enum it filled.",
    summary:
      "Structured Outputs is a genuine step up from raw JSON mode: with strict schema enforcement you are guaranteed valid structure and a value from the enum you declared, which is excellent for tool arguments and extraction. What it still does not give you is calibration. A strict enum field is filled by constrained decoding — the value is guaranteed to be one of your options, but there is no probability over those options and no confidence to gate on. OpenJev is the complement for the decision fields: it returns the distribution across the same closed set and a calibrated confidence, so instead of trusting the one value the schema allowed, you can act on the sure ones and escalate the rest. Many teams keep Structured Outputs for the extraction fields and route the enums through openjev.",
    rows: [
      {
        dimension: "Schema conformance",
        openjev: "Typed answers valid by construction",
        other: "Strict JSON Schema, guaranteed conformant",
        edge: "even",
      },
      {
        dimension: "Enum confidence",
        openjev: "Calibrated confidence on every Choice",
        other: "None — a strict enum is still one sampled value",
        edge: "openjev",
      },
      {
        dimension: "Distribution over options",
        openjev: "Full probability mass across the set",
        other: "Single value, no runner-up probabilities",
        edge: "openjev",
      },
      {
        dimension: "Determinism",
        openjev: "Deterministic per state + questions",
        other: "Structure is fixed; the value still samples",
        edge: "openjev",
      },
      {
        dimension: "Nested objects & free-text fields",
        openjev: "Not the job — one typed question per value",
        other: "Handles arbitrary nested schemas and strings",
        edge: "other",
      },
      {
        dimension: "Extraction of unknown values",
        openjev: "Requires a declared question per field",
        other: "Pulls names, amounts, nested records from text",
        edge: "other",
      },
      {
        dimension: "Cost / latency at volume",
        openjev: "Near-zero output tokens; local ms latency",
        other: "Generates the full JSON payload as tokens",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You are producing tool-call arguments or extracting a rich, nested object from text.",
      "You need the response to conform to a specific JSON Schema exactly.",
      "The fields are content and structure, not judgments over a known set.",
    ],
    whenOts: [
      "The fields that matter are enums, ratings, or yes/no gates.",
      "You want to route on a calibrated confidence, not read one allowed value.",
      "You want the distribution over the options, including the runner-up.",
    ],
    code: {
      otherLabel: "Structured Outputs",
      other: `const res = await client.responses.parse({
  model: "gpt-4o",
  input: ticket,
  text: { format: zodTextFormat(z.object({
    category: z.enum(["refund", "rebooking", "info"]),
  }), "triage") },
});
const { category } = res.output_parsed;
// Guaranteed a valid enum. But no P(category), no confidence.`,
      otsLabel: "openjev",
      ots: `const { answers } = await client.systemOne({
  state: { ticket },
  questions: {
    category: choice("Main request in \\\`ticket\\\`?", {
      refund: "Wants money returned.",
      rebooking: "Wants a replacement flight.",
      info: "Asking for information only.",
    }),
  },
});
const c = answers.category; // { choice, probabilities, confidence }
if (c.confidence < 0.6) escalate(); else route(c.choice);`,
    },
  },
  {
    slug: "vs-outlines",
    title: "openjev vs Outlines (constrained decoding)",
    navLabel: "vs Outlines",
    otherLabel: "Outlines / constrained decoding",
    otherBlurb:
      "Outlines steers open-weight model generation with a grammar, regex, or JSON schema so tokens are sampled only where they satisfy the constraint — structured generation at the decoding layer.",
    tagline:
      "Outlines guarantees the shape by construction at decode time. OpenJev adds the probability the shape was hiding.",
    summary:
      "Outlines is a strong library for structured generation on open-weight models: by masking the token distribution to a grammar or schema it makes malformed output impossible, which is great for JSON, regex-shaped fields, and multiple-choice tokens. It operates one layer below OpenJev — it constrains how a model generates, whereas OpenJev is the decision primitive itself. For a closed-choice field Outlines will happily emit a valid label, but the emitted token is the argmax of a constrained sample; it is not handed back to you as a calibrated confidence with the full distribution over the choices. OpenJev is narrower and higher-level: for the decision it returns the distribution and a confidence you threshold, and it runs the same request across five backends without you wiring a decoding grammar. If you are building your own inference stack, Outlines is a fine building block; if you want a typed decision as a service, that is openjev.",
    rows: [
      {
        dimension: "Guaranteed shape",
        openjev: "Typed answers valid by construction",
        other: "Grammar/schema-constrained at decode time",
        edge: "even",
      },
      {
        dimension: "Calibrated confidence",
        openjev: "Yes, per decision",
        other: "Not surfaced — you get the constrained token",
        edge: "openjev",
      },
      {
        dimension: "Distribution over a closed set",
        openjev: "Returned as first-class output",
        other: "Available in logprobs, but you assemble it yourself",
        edge: "openjev",
      },
      {
        dimension: "Level of abstraction",
        openjev: "A decision as a service — send state + questions",
        other: "A decoding library you wire into an inference stack",
        edge: "even",
      },
      {
        dimension: "Arbitrary JSON / regex generation",
        openjev: "Not the job",
        other: "Core strength — grammars, regex, JSON schema",
        edge: "other",
      },
      {
        dimension: "Backend flexibility",
        openjev: "Same request on 5 backends, no grammar to author",
        other: "Tied to model runtimes it can steer",
        edge: "openjev",
      },
      {
        dimension: "Cost / latency",
        openjev: "Near-zero output tokens on local backends",
        other: "Still generates constrained tokens",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You are building an inference stack and want structured generation at the decoding layer.",
      "You need arbitrary grammar-, regex-, or JSON-schema-shaped output from an open-weight model.",
      "You want fine control over how tokens are constrained during sampling.",
    ],
    whenOts: [
      "You want a typed decision as a service, not a decoding grammar to author and host.",
      "You want the calibrated confidence and distribution handed back, not reconstructed from logprobs.",
      "You want one request to run across local and hosted backends unchanged.",
    ],
    code: {
      otherLabel: "Outlines",
      other: `import outlines
model = outlines.models.transformers("...")
generator = outlines.generate.choice(
    model, ["refund", "rebooking", "info"]
)
category = generator(ticket)
# A valid label, chosen by constrained decoding.
# No confidence handed back; assemble it from logprobs yourself.`,
      otsLabel: "openjev",
      ots: `out = openjev.ask(
    state={"ticket": ticket},
    questions={
        "category": Choice("Main request?", {
            "refund": "Wants money returned.",
            "rebooking": "Wants a replacement flight.",
            "info": "Asking for information only.",
        }),
    },
)
c = out["answers"]["category"]  # choice, probabilities, confidence
if c["confidence"] < 0.6: escalate()`,
    },
  },
  {
    slug: "vs-pydantic-ai",
    title: "openjev vs Pydantic-AI",
    navLabel: "vs Pydantic-AI",
    otherLabel: "Pydantic-AI",
    otherBlurb:
      "Pydantic-AI is an agent framework that returns validated Pydantic models from LLM calls, with typed dependencies, tools, and structured results across providers.",
    tagline:
      "Pydantic-AI is a great typed agent framework. OpenJev is the calibrated decision you can use inside it.",
    summary:
      "Pydantic-AI brings Pydantic's validation ergonomics to agents: typed results, tool calling, dependency injection, and provider-agnostic runs. If you want a validated object out of an agent, it is an excellent choice. It overlaps with OpenJev only on the decision-shaped fields, and there the difference is the same one that separates validation from calibration — a validated result_type field is the model's single answer coerced into your schema, with no probability behind it. OpenJev is not an agent framework and does not compete with the orchestration; it is the primitive you call for the judgment. A natural pairing is Pydantic-AI running the agent and OpenJev making the routing, verification, and gating decisions inside it, so those decisions come with a confidence instead of a coerced value.",
    rows: [
      {
        dimension: "Typed result",
        openjev: "Typed Choice / Score / Noul",
        other: "Validated Pydantic model",
        edge: "even",
      },
      {
        dimension: "Calibrated confidence",
        openjev: "Yes, per decision",
        other: "No — validation checks shape, not certainty",
        edge: "openjev",
      },
      {
        dimension: "Distribution over options",
        openjev: "Full mass across the set",
        other: "Single coerced value",
        edge: "openjev",
      },
      {
        dimension: "Agent orchestration",
        openjev: "Not the job — a decision primitive",
        other: "Core strength — tools, deps, control flow",
        edge: "other",
      },
      {
        dimension: "Rich object extraction",
        openjev: "One typed question per value",
        other: "Nested models, lists, optionals",
        edge: "other",
      },
      {
        dimension: "Determinism of the decision",
        openjev: "Deterministic per state + questions",
        other: "Inherits the LLM's sampling variance",
        edge: "openjev",
      },
      {
        dimension: "Cost of a decision",
        openjev: "Near-zero output tokens on local backends",
        other: "A generative call per model produced",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You want a typed agent framework: tools, typed dependencies, validated results across providers.",
      "The output is a rich object extracted or composed by the agent.",
      "You need orchestration, not just a single judgment.",
    ],
    whenOts: [
      "The field is a classification, rating, or boolean gate inside the agent.",
      "You want a calibrated confidence and distribution, not a coerced value.",
      "You want the decision to be deterministic and cheap on the loop's hot path.",
    ],
    code: {
      otherLabel: "Pydantic-AI",
      other: `class Triage(BaseModel):
    category: Literal["refund", "rebooking", "info"]

agent = Agent("openai:gpt-4o", output_type=Triage)
result = agent.run_sync(ticket)
# result.output.category is a validated value.
# No probability, no confidence to gate on.`,
      otsLabel: "openjev",
      ots: `out = openjev.ask(
    state={"ticket": ticket},
    questions={
        "category": Choice("Main request?", {
            "refund": "Wants money returned.",
            "rebooking": "Wants a replacement flight.",
            "info": "Asking for information only.",
        }),
    },
)
c = out["answers"]["category"]  # choice, probabilities, confidence
if c["confidence"] < 0.6: escalate()`,
    },
  },
  {
    slug: "vs-langchain-structured",
    title: "openjev vs LangChain with_structured_output",
    navLabel: "vs LangChain structured",
    otherLabel: "LangChain structured output",
    otherBlurb:
      "LangChain's with_structured_output binds a schema (Pydantic/TypedDict/JSON Schema) to a chat model so chains return a typed object instead of raw text.",
    tagline:
      "LangChain structures the output of a chain. OpenJev is the calibrated decision that chain can call.",
    summary:
      "with_structured_output is the ergonomic way to get a typed object out of a LangChain model — bind a schema and the chain returns it, using the provider's function-calling or JSON mode under the hood. It is convenient and provider-portable, and for extraction and tool arguments it is the right tool. On the decision fields it inherits the same limitation as everything built on schema-constrained generation: a bound enum is one sampled value with no probability behind it. OpenJev is not a chain framework; it is the decision primitive you invoke from a chain. Keep LangChain for orchestration and extraction, and route the enums, ratings, and gates through OpenJev so those steps come back with a distribution and a confidence you can branch on — the same primitive works for routing, ranking, and verification steps in the chain.",
    rows: [
      {
        dimension: "Typed object",
        openjev: "Typed Choice / Score / Noul",
        other: "Typed object from the bound schema",
        edge: "even",
      },
      {
        dimension: "Per-field confidence",
        openjev: "Calibrated confidence on every decision",
        other: "None — a bound enum is a sampled value",
        edge: "openjev",
      },
      {
        dimension: "Distribution",
        openjev: "Full probability mass over the options",
        other: "Single value, no runner-up probabilities",
        edge: "openjev",
      },
      {
        dimension: "Chain orchestration & integrations",
        openjev: "Not the job — a decision primitive",
        other: "Core strength — the whole point of LangChain",
        edge: "other",
      },
      {
        dimension: "Extraction of rich objects",
        openjev: "One typed question per value",
        other: "Nested schemas, lists, optionals",
        edge: "other",
      },
      {
        dimension: "Determinism of the decision",
        openjev: "Deterministic per state + questions",
        other: "Inherits sampling variance",
        edge: "openjev",
      },
      {
        dimension: "Cost of a decision",
        openjev: "Near-zero output tokens on local backends",
        other: "A generative call per structured output",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You are building a chain and want a typed object out of a model step.",
      "The output is extraction or tool arguments, not a judgment over a known set.",
      "You want LangChain's ecosystem of integrations and orchestration.",
    ],
    whenOts: [
      "The step is a classification, rating, or yes/no gate in the chain.",
      "You want a calibrated confidence and distribution, not one bound value.",
      "You want the same decision primitive for routing, ranking, and verification steps.",
    ],
    code: {
      otherLabel: "LangChain",
      other: `class Triage(BaseModel):
    category: Literal["refund", "rebooking", "info"]

structured = llm.with_structured_output(Triage)
result = structured.invoke(ticket)
# result.category is typed. No probability, no confidence.`,
      otsLabel: "openjev",
      ots: `out = openjev.ask(
    state={"ticket": ticket},
    questions={
        "category": Choice("Main request?", {
            "refund": "Wants money returned.",
            "rebooking": "Wants a replacement flight.",
            "info": "Asking for information only.",
        }),
    },
)
c = out["answers"]["category"]  # choice, probabilities, confidence
if c["confidence"] < 0.6: escalate()`,
    },
  },
  // ─── NEW entries appended below ───────────────────────────────────────────
  {
    slug: "vs-jev",
    title: "openjev vs the upstream hosted cloud",
    navLabel: "vs hosted cloud",
    otherLabel: "Hosted cloud (closed-source)",
    otherBlurb:
      "The upstream managed cloud service that introduced the Choice / Score / Noul primitives and the /v1/systemone wire format. OpenJev is the open-source, self-hostable implementation that is wire-compatible with it.",
    tagline:
      "Same primitives, same wire format — open-source with full backend control vs a managed SaaS.",
    summary:
      "openjev and the upstream cloud share the same decision model: Choice, Score, Noul, and the POST /v1/systemone envelope. The @caelum/typesafe SDK targets both without code changes. The fork point is hosting and backend. The cloud service runs a proprietary backend and owns the model weights, which means zero infra work and a vendor SLA, but your data crosses the wire and you pay per call. OpenJev lets you run the same request on a local engine with zero marginal cost, swap to the C++/Rust kernel for high-throughput batch, or fall back to any hosted LLM via the any-LLM backend. If you are evaluating which to start with: prototype on the cloud tier (no setup), migrate to OpenJev when volume, data-residency, or cost makes the switch worth it — the API is the same.",
    rows: [
      {
        dimension: "API / wire format",
        openjev: "POST /v1/systemone — same wire format",
        other: "POST /v1/systemone — the original",
        edge: "even",
      },
      {
        dimension: "Primitives",
        openjev: "Choice / Score / Noul — identical",
        other: "Choice / Score / Noul — the original",
        edge: "even",
      },
      {
        dimension: "SDK compatibility",
        openjev: "@caelum/typesafe works unchanged against both",
        other: "Same SDK target",
        edge: "even",
      },
      {
        dimension: "Hosting",
        openjev: "Self-host: laptop, server, or any cloud",
        other: "Fully managed SaaS — zero infra",
        edge: "even",
      },
      {
        dimension: "Data residency",
        openjev: "Data stays on your infra; no third-party egress",
        other: "Data processed on the upstream cloud",
        edge: "openjev",
      },
      {
        dimension: "Backend choice",
        openjev: "laya-mlx / laya-onnx / C++–Rust kernel / pure-TS / any-LLM",
        other: "Upstream proprietary backend",
        edge: "openjev",
      },
      {
        dimension: "Cost at volume",
        openjev: "Zero marginal cost on local backends",
        other: "Per-call pricing",
        edge: "openjev",
      },
      {
        dimension: "Ops burden",
        openjev: "You run and update the service",
        other: "None — fully managed",
        edge: "other",
      },
      {
        dimension: "SLA / uptime",
        openjev: "Yours to guarantee",
        other: "Vendor SLA",
        edge: "other",
      },
      {
        dimension: "Auditability",
        openjev: "Full source available — inspect everything",
        other: "Closed source",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You want zero infrastructure: no model hosting, no ops, just an API key.",
      "A vendor SLA matters more than data-residency or cost at scale.",
      "You are prototyping and want to defer the infra decision.",
    ],
    whenOts: [
      "Your data must not leave your own infrastructure.",
      "Volume makes per-call cloud pricing significant.",
      "You want to run on your own hardware (edge, air-gapped, on-prem).",
      "You want to audit, fork, or customise the decision engine itself.",
    ],
    code: {
      otherLabel: "Hosted cloud",
      other: `import { SystemOneClient } from "@caelum/typesafe";

// Point at the managed cloud endpoint
const client = new SystemOneClient({
  baseUrl: "http://localhost:3000",
  apiKey: process.env.OPENJEV_API_KEY,
});

const { answers } = await client.systemOne({
  model: "system-one",
  state: { ticket },
  questions: {
    category: choice("Main request?", {
      refund: "Wants money returned.",
      info:   "Asking for information only.",
    }),
  },
});`,
      otsLabel: "openjev (self-hosted)",
      ots: `import { SystemOneClient } from "@caelum/typesafe";

// Same SDK, different baseUrl — that is the entire migration
const client = new SystemOneClient({
  baseUrl: "http://localhost:8080",  // your own OpenJev instance
  // no apiKey needed for local deployment
});

const { answers } = await client.systemOne({
  model: "system-one",
  state: { ticket },
  questions: {
    category: choice("Main request?", {
      refund: "Wants money returned.",
      info:   "Asking for information only.",
    }),
  },
});
// Identical response shape; answers.category.choice / .confidence / .probabilities`,
    },
  },
  {
    slug: "vs-typesafe-cloud",
    title: "openjev self-hosted vs OpenJev Cloud (managed API)",
    navLabel: "vs OpenJev Cloud",
    otherLabel: "OpenJev Cloud (managed API)",
    otherBlurb:
      "OpenJev Cloud is the hosted, managed deployment of openjev: same open-source codebase, operated as a cloud API so you get the primitives without running infrastructure.",
    tagline:
      "Managed convenience vs total control — both run the identical OpenJev engine.",
    summary:
      "OpenJev Cloud and a self-hosted OpenJev instance are the same software: the Decision API (POST /v1/systemone), the same Choice / Score / Noul primitives, and the same @caelum/typesafe SDK wire format. The split is operational. The cloud tier handles capacity, updates, and availability so you ship without an ops story; self-hosting puts model selection, data residency, and latency under your control. The right answer depends almost entirely on your current scale and compliance constraints — start on the managed tier and move the flag when you need to.",
    rows: [
      {
        dimension: "API / wire format",
        openjev: "POST /v1/systemone — same",
        other: "POST /v1/systemone — same",
        edge: "even",
      },
      {
        dimension: "Codebase",
        openjev: "The OpenJev OSS repository",
        other: "The same OpenJev OSS repository, managed",
        edge: "even",
      },
      {
        dimension: "Setup time",
        openjev: "Minutes to hours (model download, config)",
        other: "Seconds — create an account, get a key",
        edge: "other",
      },
      {
        dimension: "Data residency",
        openjev: "Your own infra; no third-party egress",
        other: "Cloud; you choose the region",
        edge: "openjev",
      },
      {
        dimension: "Backend selection",
        openjev: "Pick any of the 5 backends per deployment",
        other: "Cloud chooses the backend for you",
        edge: "openjev",
      },
      {
        dimension: "Latency",
        openjev: "Engine time only when collocated (" + ML.embedding1 + " measured on the default embedding engine)",
        other: "Network round-trip to the nearest region",
        edge: "openjev",
      },
      {
        dimension: "Cost model",
        openjev: "Amortised hardware; zero marginal at volume",
        other: "Per-request pricing",
        edge: "openjev",
      },
      {
        dimension: "Ops burden",
        openjev: "You run, update, and scale it",
        other: "Fully managed — no servers to touch",
        edge: "other",
      },
      {
        dimension: "Auto-scaling",
        openjev: "Your responsibility",
        other: "Automatic",
        edge: "other",
      },
    ],
    whenOther: [
      "You are shipping a prototype and do not want an ops story yet.",
      "You have variable or bursty traffic and want auto-scaling.",
      "Compliance allows cloud processing and you want to move fast.",
    ],
    whenOts: [
      "Regulations require data to stay on your own infrastructure.",
      "Steady high volume makes per-request cloud cost significant.",
      "You want decisions collocated with your application, with no network hop to a vendor.",
      "You want to choose or tune the backend model yourself.",
    ],
    code: {
      otherLabel: "OpenJev Cloud",
      other: `import { SystemOneClient } from "@caelum/typesafe";

const client = new SystemOneClient({
  baseUrl: "http://localhost:3000",
  apiKey: process.env.OPENJEV_API_KEY,
});

const { answers } = await client.systemOne({
  model: "system-one",
  state: { review },
  questions: {
    sentiment: choice("Sentiment of \\\`review\\\`?", {
      positive: "Broadly happy.",
      negative: "Broadly unhappy.",
      neutral:  "Mixed or no strong feeling.",
    }),
  },
});`,
      otsLabel: "openjev self-hosted",
      ots: `import { SystemOneClient } from "@caelum/typesafe";

// docker run -p 8080:8080 openjev/server --backend laya-onnx
const client = new SystemOneClient({
  baseUrl: "http://localhost:8080",
});

// Identical request — swap baseUrl and the rest is unchanged
const { answers } = await client.systemOne({
  model: "system-one",
  state: { review },
  questions: {
    sentiment: choice("Sentiment of \\\`review\\\`?", {
      positive: "Broadly happy.",
      negative: "Broadly unhappy.",
      neutral:  "Mixed or no strong feeling.",
    }),
  },
});
// answers.sentiment.choice / .confidence / .probabilities — same shape`,
    },
  },
  {
    slug: "vs-dspy",
    title: "openjev vs DSPy",
    navLabel: "vs DSPy",
    otherLabel: "DSPy (Stanford LM programming framework)",
    otherBlurb:
      "DSPy is a framework for programming, not prompting, language models. You declare a pipeline as composable modules (Predict, ChainOfThought, ReAct, etc.) and an optimizer (BootstrapFewShot, MIPROv2) tunes prompts and few-shot examples automatically to maximise a metric.",
    tagline:
      "DSPy optimises the whole LM pipeline. OpenJev is the calibrated decision node you can put inside one.",
    summary:
      "DSPy is a fundamentally different abstraction: instead of writing prompts you write programs — typed signatures, modules, and an optimizer that searches for the best instructions and examples to hit a metric. That is powerful for chains, agents, and pipelines where prompt quality is a bottleneck. It does not change the calibration problem: a Predict module's output is still a sampled value, and even a TypedPredictor with a Pydantic output type gives you one value with no probability behind it. OpenJev is not a pipeline framework — it is the calibrated decision primitive you can call from a DSPy module when the step is a classification, rating, or boolean gate and you need the confidence and distribution, not just the answer. The two are composable: DSPy to compose and optimise the reasoning, OpenJev for the typed judgments inside it.",
    rows: [
      {
        dimension: "Primary role",
        openjev: "Single calibrated decision primitive",
        other: "Full LM program composition and optimisation",
        edge: "even",
      },
      {
        dimension: "Calibrated confidence",
        openjev: "Yes, per Choice / Score / Noul",
        other: "No — TypedPredictor gives one coerced value",
        edge: "openjev",
      },
      {
        dimension: "Distribution over options",
        openjev: "Returned as first-class output",
        other: "Single value; logprobs not surfaced by default",
        edge: "openjev",
      },
      {
        dimension: "Prompt optimisation",
        openjev: "Not provided — questions are explicit",
        other: "Core strength — BootstrapFewShot, MIPROv2, etc.",
        edge: "other",
      },
      {
        dimension: "Pipeline & chain composition",
        openjev: "Not the job — a single request",
        other: "Core strength — modules, retrieve, agents",
        edge: "other",
      },
      {
        dimension: "Backend",
        openjev: "5 backends including local; no LLM required",
        other: "Any LLM provider DSPy supports",
        edge: "openjev",
      },
      {
        dimension: "Cost of a decision at volume",
        openjev: "Near-zero on local backends",
        other: "LLM call per module invocation",
        edge: "openjev",
      },
      {
        dimension: "Determinism of the decision",
        openjev: "Deterministic per state + questions",
        other: "Depends on optimised prompt + LLM sampling",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You need to compose a multi-step reasoning pipeline and want automatic prompt optimisation.",
      "The quality of the prompt itself is the bottleneck and you have a labelled metric to optimise against.",
      "You are building a retrieval-augmented or agentic system that needs orchestration primitives.",
    ],
    whenOts: [
      "The step is a classification, rating, or boolean gate and you need the calibrated confidence.",
      "You want the distribution across the options, not one optimised best-guess.",
      "You want the decision to be deterministic and cheap on the hot path.",
    ],
    code: {
      otherLabel: "DSPy TypedPredictor",
      other: `import dspy
from typing import Literal

class TriageSignature(dspy.Signature):
    """Classify the support ticket."""
    ticket: str = dspy.InputField()
    category: Literal["refund", "rebooking", "info"] = dspy.OutputField()

predictor = dspy.TypedPredictor(TriageSignature)
result = predictor(ticket=ticket)
# result.category is optimised and valid.
# No probability, no confidence to gate on.`,
      otsLabel: "openjev",
      ots: `import openjev

out = openjev.ask(
    state={"ticket": ticket},
    questions={
        "category": Choice("Main request in \\\`ticket\\\`?", {
            "refund":    "Wants money returned.",
            "rebooking": "Wants a replacement flight.",
            "info":      "Asking for information only.",
        }),
    },
)
c = out["answers"]["category"]  # choice, probabilities, confidence
if c["confidence"] < 0.6:
    escalate()
else:
    route(c["choice"])`,
    },
  },
  {
    slug: "vs-baml",
    title: "openjev vs BAML",
    navLabel: "vs BAML",
    otherLabel: "BAML (Boundary ML)",
    otherBlurb:
      "BAML is a domain-specific language for defining LLM functions. You write .baml files that describe the function's input, output type, prompt, and retry/fallback logic; a code generator emits type-safe clients in TypeScript, Python, and Ruby from them.",
    tagline:
      "BAML generates typed LLM function clients from a DSL. OpenJev is the wire-ready decision API you call directly.",
    summary:
      "BAML has a different model: you author a .baml file, run baml-cli generate, and receive strongly-typed client code that handles retries, fallbacks, and streaming. The generated client is excellent for complex LLM functions with rich outputs and tight prompt control, and its test tooling makes iterating on prompts fast. The limitation for decision-shaped calls is the same as everywhere else on schema-constrained generation: a BAML enum field is one sampled value with no calibrated probability behind it. OpenJev has no generation step and no DSL — you call /v1/systemone directly, get back the distribution and confidence, and run on local backends with no generation cost. They are not really in competition: BAML for LLM functions with complex prompts and types, OpenJev for the classification, routing, and gating decisions that need a calibrated answer rather than a generated one.",
    rows: [
      {
        dimension: "Typed result",
        openjev: "Typed Choice / Score / Noul, no codegen needed",
        other: "Generated typed client from .baml schema",
        edge: "even",
      },
      {
        dimension: "Calibrated confidence",
        openjev: "Yes, per decision",
        other: "No — an enum field is a sampled value",
        edge: "openjev",
      },
      {
        dimension: "Distribution over options",
        openjev: "Returned as first-class output",
        other: "Single value; no runner-up probabilities",
        edge: "openjev",
      },
      {
        dimension: "Code generation / DSL",
        openjev: "None — declare questions at runtime",
        other: ".baml files → typed clients in TS/Python/Ruby",
        edge: "even",
      },
      {
        dimension: "Retry / fallback logic",
        openjev: "Not built-in — answers are valid by construction",
        other: "Built-in: retry_policy, fallback_client, streaming",
        edge: "other",
      },
      {
        dimension: "Prompt control",
        openjev: "Instruction-level via question descriptions",
        other: "Full prompt template in the .baml file",
        edge: "other",
      },
      {
        dimension: "Backend",
        openjev: "5 backends; runs fully offline on local engines",
        other: "Any LLM provider configured in clients.baml",
        edge: "openjev",
      },
      {
        dimension: "Cost of a decision",
        openjev: "Near-zero on local backends",
        other: "LLM generation tokens per call",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You want prompt templates, retry policies, and fallback clients defined declaratively in a DSL.",
      "You need a generated typed client in multiple languages from a single source of truth.",
      "The LLM function produces a rich structured output — not just a decision.",
    ],
    whenOts: [
      "The step is a classification, rating, or boolean gate — you need the calibrated confidence and distribution.",
      "You want to run the decision locally with no generation cost and no codegen step.",
      "You want deterministic, reproducible answers you can threshold in code.",
    ],
    code: {
      otherLabel: "BAML function",
      other: `// triage.baml
function ClassifyTicket(ticket: string) -> Category {
  client GPT4o
  prompt #"
    Classify the support ticket into one of: refund, rebooking, info.
    Ticket: {{ ticket }}
  "#
}
enum Category { Refund Rebooking Info }

// Generated TypeScript usage:
import { b } from "./baml_client";
const category = await b.ClassifyTicket(ticket);
// category is "Refund" | "Rebooking" | "Info". No confidence.`,
      otsLabel: "openjev",
      ots: `import { SystemOneClient, choice } from "@caelum/typesafe";

const client = new SystemOneClient({ baseUrl: "http://localhost:8080" });

const { answers } = await client.systemOne({
  model: "system-one",
  state: { ticket },
  questions: {
    category: choice("Main request in \\\`ticket\\\`?", {
      refund:    "Wants money returned.",
      rebooking: "Wants a replacement flight.",
      info:      "Asking for information only.",
    }),
  },
});
// answers.category.choice / .confidence / .probabilities
// No .baml file, no codegen — declare and call.`,
    },
  },
  {
    slug: "vs-marvin",
    title: "openjev vs Marvin",
    navLabel: "vs Marvin",
    otherLabel: "Marvin (Prefect AI functions library)",
    otherBlurb:
      "Marvin is a Python library that turns functions and types into AI-powered operations using decorators: @marvin.fn, @marvin.classify, marvin.cast, marvin.extract — wrapping an LLM call behind a Pythonic interface.",
    tagline:
      "Marvin makes AI functions feel like Python functions. OpenJev makes the decision calibrated.",
    summary:
      "Marvin is excellent developer ergonomics: decorate a function, describe it in a docstring, and it becomes an AI-powered call that returns a typed Python value. The @marvin.classify decorator is the closest analogue to openjev's Choice — you give it a list of options and it returns one. For a lot of tasks that is enough. The gap is calibration: @marvin.classify returns the winning label; it does not hand you back the probability mass over the set or a confidence you can threshold. If you need to route 'high confidence yes' differently from 'low confidence yes' or surface the runner-up option, you need the distribution. OpenJev is also runtime-backend-agnostic — the same classification call runs on a local laya-onnx kernel or any hosted LLM without changing the code. Marvin always calls a generative LLM behind the decorator. Use Marvin for rich AI-powered functions; use OpenJev for the decision fields where you need the probability, not just the label.",
    rows: [
      {
        dimension: "Classify / choice",
        openjev: "Choice with confidence (calibration measured on /leaderboard) + full distribution",
        other: "@marvin.classify returns one label",
        edge: "openjev",
      },
      {
        dimension: "Calibrated confidence",
        openjev: "Yes, per Choice / Score / Noul",
        other: "No — the decorated call returns the winner",
        edge: "openjev",
      },
      {
        dimension: "Distribution over options",
        openjev: "Full probability mass returned",
        other: "Single value; no runner-up probabilities",
        edge: "openjev",
      },
      {
        dimension: "Developer ergonomics",
        openjev: "Explicit questions dict — no decorator magic",
        other: "Decorator + docstring — feels like a Python function",
        edge: "even",
      },
      {
        dimension: "Rich extraction & casting",
        openjev: "Not the job — one typed question per value",
        other: "marvin.cast and marvin.extract pull rich types",
        edge: "other",
      },
      {
        dimension: "AI functions (free-form)",
        openjev: "Cannot — never generates text",
        other: "Core strength — @marvin.fn turns any signature into an AI call",
        edge: "other",
      },
      {
        dimension: "Backend",
        openjev: "5 backends; local engines with zero marginal cost",
        other: "Any LLM Marvin supports (OpenAI default)",
        edge: "openjev",
      },
      {
        dimension: "Determinism of the decision",
        openjev: "Deterministic per state + questions",
        other: "Inherits the LLM's sampling variance",
        edge: "openjev",
      },
    ],
    whenOther: [
      "You want AI-powered functions that feel like native Python — decorator-driven.",
      "You are casting unstructured text into a rich typed object (marvin.cast / extract).",
      "The call needs free-form reasoning or generation, not just a judgment.",
    ],
    whenOts: [
      "The step is a classification, rating, or boolean gate and you need the calibrated confidence.",
      "You want the full probability distribution over the options, not just the winning label.",
      "You want the decision to run locally with no per-call LLM cost.",
    ],
    code: {
      otherLabel: "Marvin classify",
      other: `import marvin
from enum import Enum

class Category(Enum):
    REFUND    = "refund"
    REBOOKING = "rebooking"
    INFO      = "info"

category = marvin.classify(
    ticket,
    labels=Category,
    instructions="Classify this support ticket.",
)
# category is Category.REFUND / REBOOKING / INFO.
# No confidence, no distribution.`,
      otsLabel: "openjev",
      ots: `import openjev

out = openjev.ask(
    state={"ticket": ticket},
    questions={
        "category": Choice("Main request in \\\`ticket\\\`?", {
            "refund":    "Wants money returned.",
            "rebooking": "Wants a replacement flight.",
            "info":      "Asking for information only.",
        }),
    },
)
c = out["answers"]["category"]
# c["choice"] / c["probabilities"] / c["confidence"]
if c["confidence"] < 0.6:
    escalate()`,
    },
  },
  {
    slug: "vs-zod-and-llm",
    title: "openjev vs Zod + LLM (DIY structured output)",
    navLabel: "vs Zod + LLM",
    otherLabel: "Zod schema + raw LLM call (DIY)",
    otherBlurb:
      "A common TypeScript pattern: define a Zod schema, call an LLM in JSON mode or with a schema hint, then z.parse() the response — rolling your own structured output without an extra library.",
    tagline:
      "Zod validates that the answer parsed. It does not tell you how confident the model was.",
    summary:
      "The Zod-plus-LLM pattern is entirely reasonable and widely used in TypeScript projects: write a schema, call the LLM, parse with Zod, catch and retry on ZodError. For extraction tasks with many fields it is often the lightest-weight option. For decision-shaped fields — classifications, ratings, yes/no gates — it shares the same fundamental gap as every schema-constrained generation approach: Zod validates structure, not certainty. A z.enum(['refund','rebooking','info']) field that passes parse() is structurally valid; it is still one sampled token with no probability behind it, and you will write retry logic, error handling, and confidence heuristics yourself. OpenJev replaces the decision fields specifically: the answers are valid by construction (no ZodError loop), they come with a calibrated confidence, and they run on local backends with no generation cost. You can keep Zod everywhere else in your codebase and call OpenJev only for the classification and gating steps.",
    rows: [
      {
        dimension: "Typed result",
        openjev: "Typed Choice / Score / Noul, valid by construction",
        other: "Typed from your Zod schema after parse()",
        edge: "even",
      },
      {
        dimension: "Validation failure handling",
        openjev: "Answers always valid — no retry loop",
        other: "ZodError on malformed LLM output; you write retries",
        edge: "openjev",
      },
      {
        dimension: "Calibrated confidence",
        openjev: "Yes, per decision",
        other: "None — a z.enum field is a sampled token",
        edge: "openjev",
      },
      {
        dimension: "Distribution over options",
        openjev: "Full probability mass returned",
        other: "Single value; no runner-up probabilities",
        edge: "openjev",
      },
      {
        dimension: "Flexibility of the schema",
        openjev: "Closed set of typed questions only",
        other: "Any Zod shape: nested objects, arrays, optional fields",
        edge: "other",
      },
      {
        dimension: "Existing dependency",
        openjev: "Adds OpenJev and its backend",
        other: "Zod already in almost every TypeScript project",
        edge: "other",
      },
      {
        dimension: "Cost at volume",
        openjev: "Near-zero on local backends",
        other: "LLM generation tokens per call + retry tokens",
        edge: "openjev",
      },
      {
        dimension: "Ops requirement",
        openjev: "Run an OpenJev instance (or use the cloud API)",
        other: "None beyond an LLM API key",
        edge: "other",
      },
    ],
    whenOther: [
      "You need a flexible schema with nested objects, arrays, and optional fields.",
      "Zod is already in your project and the simplest path wins.",
      "The output is extraction, not a decision from a closed set.",
    ],
    whenOts: [
      "The fields are classifications, ratings, or yes/no gates — you need calibrated confidence.",
      "You are tired of writing retry logic around ZodError for enum fields.",
      "You want the decision to run locally with no generation cost.",
      "You want the full distribution to route 'confident yes' differently from 'uncertain yes'.",
    ],
    code: {
      otherLabel: "Zod + LLM",
      other: `import { z } from "zod";

const triageSchema = z.object({
  category: z.enum(["refund", "rebooking", "info"]),
});

async function triageTicket(ticket: string) {
  const res = await llm.chat({
    response_format: { type: "json_object" },
    messages: [{ role: "user", content:
      'Reply with JSON: {"category":"refund"|"rebooking"|"info"}.\\n' + ticket,
    }],
  });
  // May throw ZodError; you need a retry loop
  const { category } = triageSchema.parse(
    JSON.parse(res.choices[0].message.content)
  );
  // Valid enum value. No P(category), no confidence.
  return category;
}`,
      otsLabel: "openjev",
      ots: `import { SystemOneClient, choice } from "@caelum/typesafe";

const client = new SystemOneClient({ baseUrl: "http://localhost:8080" });

const { answers } = await client.systemOne({
  model: "system-one",
  state: { ticket },
  questions: {
    category: choice("Main request in \\\`ticket\\\`?", {
      refund:    "Wants money returned.",
      rebooking: "Wants a replacement flight.",
      info:      "Asking for information only.",
    }),
  },
});
// No ZodError loop — answers always valid
// answers.category.choice / .probabilities / .confidence
if (answers.category.confidence < 0.6) escalate();
else route(answers.category.choice);`,
    },
  },
  ...TRUST_COMPARISONS,
] as const;

export function comparisonBySlug(slug: string): Comparison | undefined {
  return COMPARISONS.find((c) => c.slug === slug);
}
