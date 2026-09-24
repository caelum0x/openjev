/**
 * Trust-layer comparisons: the open Jev-style decision models (Laya, SemIf),
 * the tools people route decisions through (impossibl, Not Diamond), and the
 * classic few-shot classifier (SetFit).
 *
 * Kept in its own module so compare.ts stays readable; COMPARISONS spreads these
 * in. Every competitor fact here is attributed to the project's own public
 * material, and every OpenJev claim points at a page you can check yourself:
 * /leaderboard (re-runnable), /calibrations (fitted on your labels) and /shadow
 * (agreement on your own traffic).
 */
import type { Comparison } from "./compare";
import { CALIBRATIONS_LINK, LEADERBOARD_LINK, SELF_HOST_LINK, SHADOW_LINK } from "./proof-links";

const otsSnippet = (
  modelLine: string,
): string => `import { OpenJevClient, choice } from "@openjev/sdk";

const client = new OpenJevClient({ baseURL: process.env.OPENJEV_BASE_URL });

const { answers } = await client.systemOne({
  ${modelLine}
  state: { message },
  calibration_id: "cal_support_v3", // fitted on your labels at /calibrations
  questions: {
    intent: { ...choice("Main intent of \`message\`?", {
      refund:  "Wants money back.",
      cancel:  "Wants to end the subscription.",
      billing: "Question about a charge.",
    }), abstain: true },
  },
});

const a = answers.intent;
if (a.abstained) sendToHuman(a.abstain_reason); // "out_of_scope" | "low_confidence"
else route(a.choice, a.confidence);`;

const OTS_ABSTAIN_SNIPPET = otsSnippet(
  'model: "auto",                    // local first, LLM only when unsure',
);

export const TRUST_COMPARISONS: ReadonlyArray<Comparison> = [
  {
    slug: "vs-laya",
    title: "openjev vs Laya",
    navLabel: "vs Laya",
    otherLabel: "Laya (open-weight decision model)",
    otherBlurb:
      "An Apache-2.0, non-autoregressive System One decision model from Convai Innovations. You download the weights and run typed choice, score and yes/no decisions in a single forward pass, with a router that picks a checkpoint per request.",
    tagline:
      "Laya is a model. OpenJev runs Laya, then adds calibration to your labels, abstain, shadow mode and an LLM fallback on top.",
    summary:
      "This is not really an either/or. Laya is one of the strongest open decision models and OpenJev ships it as two backends: laya-onnx for Linux and CPU, laya-mlx for Apple Silicon. What Laya alone does not give you is the layer around the model. Its own published benchmark reports a higher calibration error than hosted Jev and a large drop on many-label sets such as Banking77, and the authors suggest temperature fitting as the fix. OpenJev does that fitting per question from your labels (/calibrations), lets any question abstain when the input fits none of the options, compares against your current LLM in shadow mode, and escalates only the unsure questions to an LLM with the auto model. If you only need raw Laya inference inside a Python process, use Laya directly.",
    rows: [
      {
        dimension: "What it is",
        openjev: "A decision service and trust layer that runs several models, Laya included",
        other: "An open-weight model plus a Python package",
        edge: "even",
      },
      {
        dimension: "Model quality",
        openjev: "Same Laya weights when you pick laya-onnx or laya-mlx",
        other: "The source of those weights",
        edge: "even",
      },
      {
        dimension: "Calibration",
        openjev:
          "Per-question temperature or isotonic maps fitted on your labels, applied with calibration_id",
        other: "Raw model probabilities; the repo suggests fitting a temperature yourself",
        edge: "openjev",
      },
      {
        dimension: "Out-of-scope inputs",
        openjev:
          "Every answer carries an ood score; abstain: true returns __none__ instead of a guess",
        other: "Always picks one of your options",
        edge: "openjev",
      },
      {
        dimension: "Unsure answers",
        openjev: 'model: "auto" re-asks only low-confidence questions to your LLM',
        other: "You build the fallback yourself",
        edge: "openjev",
      },
      {
        dimension: "Wire format",
        openjev: "POST /v1/systemone, the same envelope Jev clients already send",
        other: "A system_one(state, questions) helper in Python",
        edge: "openjev",
      },
      {
        dimension: "Footprint",
        openjev: "A web service with a database for keys, logs and calibrations",
        other: "One pip install, no server",
        edge: "other",
      },
    ],
    whenOther: [
      "You want the model in-process in Python with no HTTP hop and no server to run.",
      "You are doing research on the model itself: fine-tuning, probing, new heads.",
      "You do not need calibration to your own labels or an abstain path.",
    ],
    whenOts: [
      "You want Laya's speed with probabilities fitted to your labels.",
      "Inputs outside your label set happen in production and must not come back at 0.99.",
      "You want one API that can also serve otsone-1, the native engine or an LLM when Laya is unsure.",
      "You need shadow-mode evidence before you switch off your current LLM.",
    ],
    proof: [LEADERBOARD_LINK, CALIBRATIONS_LINK, SHADOW_LINK],
    code: {
      otherLabel: "Laya (Python)",
      other: `from laya import system_one

out = system_one(
    state=message,
    questions={"intent": {"type": "choice",
        "instructions": "Main intent?",
        "criteria": {"refund": "...", "cancel": "...", "billing": "..."}}},
)
# Raw model probabilities. Off-topic input still picks a label.
intent = out["intent"]["choice"]`,
      otsLabel: "openjev on laya-onnx",
      ots: otsSnippet('model: "laya-onnx",               // Laya weights, CPU'),
    },
  },
  {
    slug: "vs-semif",
    title: "openjev vs SemIf",
    navLabel: "vs SemIf",
    otherLabel: "SemIf (logit reader over open models)",
    otherBlurb:
      "An MIT-licensed, self-hosted project that does not train a decision model. It passes your state and typed options to an existing open model such as Qwen3.5-4B and reads the logits on the allowed answers, with no sampling.",
    tagline:
      "SemIf reads answer logits from a frozen LLM. OpenJev is the service around the decision: calibration, abstain, shadow and cascade.",
    summary:
      "SemIf is a clean idea: reuse a general open model and read its logits for your options, so there is no model to train. The trade-off, as its own write-ups note, is that probabilities read from a frozen model are not trained for the decision interface, so you fit and monitor thresholds yourself, and you need a GPU that stays busy for the cost to work out. OpenJev solves exactly that part. It fits a calibration map per question from your labels, watches it for drift, lets questions abstain on out-of-scope input, and routes only the unsure questions to an LLM. It serves its own local backends (native engine, otsone-1, Laya) rather than SemIf, so if you are committed to a logit reader on your own GPU, SemIf is the more direct tool.",
    rows: [
      {
        dimension: "Approach",
        openjev: "Dedicated decision backends plus a trust layer",
        other: "Reads option logits from a general open LLM",
        edge: "even",
      },
      {
        dimension: "Hardware",
        openjev: "CPU is enough for the native engine and laya-onnx",
        other: "Practical speed needs a GPU for a 4B model",
        edge: "openjev",
      },
      {
        dimension: "Calibration",
        openjev: "Fitted per question on your labels, with a drift monitor",
        other: "You fit and monitor thresholds yourself",
        edge: "openjev",
      },
      {
        dimension: "Abstain",
        openjev: "Opt-in __none__ answer with an out_of_scope or low_confidence reason",
        other: "Not a built-in answer",
        edge: "openjev",
      },
      {
        dimension: "Model breadth",
        openjev: "Its own backends; no general-LLM logit reading",
        other: "Any supported open model you can load",
        edge: "other",
      },
      {
        dimension: "Hosting",
        openjev: "Self-host, or the hosted tier with a free plan",
        other: "Self-host only",
        edge: "even",
      },
    ],
    whenOther: [
      "You already run a busy GPU and want to reuse a general model you trust.",
      "You want to experiment with which base model reads your options best.",
      "You are comfortable fitting and monitoring thresholds by hand.",
    ],
    whenOts: [
      "You want decisions on CPU without keeping a GPU warm.",
      "You need probabilities that match your own labels, and to know when they drift.",
      "Out-of-scope inputs must abstain rather than pick the least-bad option.",
    ],
    proof: [LEADERBOARD_LINK, CALIBRATIONS_LINK],
    code: {
      otherLabel: "SemIf (conceptual)",
      other: `# Pseudocode for the logit-reading approach:
# 1. Load a frozen open model (e.g. Qwen3.5-4B) on a GPU.
# 2. Render state + question + options into a prompt.
# 3. Read the logits on each option token, softmax them.
# 4. Pick a threshold by hand and re-check it as traffic changes.`,
      otsLabel: "openjev",
      ots: OTS_ABSTAIN_SNIPPET,
    },
  },
  {
    slug: "vs-impossibl",
    title: "openjev vs impossibl",
    navLabel: "vs impossibl",
    otherLabel: "impossibl (LLM API gateway)",
    otherBlurb:
      "A hosted gateway that puts many LLM providers behind one OpenAI- and Anthropic-compatible endpoint, with one key, consolidated billing and automatic fallbacks between providers.",
    tagline:
      "impossibl decides which provider answers your prompt. OpenJev decides whether you need a prompt at all.",
    summary:
      "These tools sit at different layers and work well together. A gateway like impossibl makes every LLM call easier to route, bill and fail over, but each call is still a generated answer with no calibrated confidence and no abstain. OpenJev answers closed-set decisions locally, returns a probability you can gate on, and only calls an LLM for the questions it is unsure about. That escalation goes to any OpenAI-compatible endpoint set in OPENAI_BASE_URL, so a gateway can serve as the escalation target. If your problem is juggling providers for chat and generation, use a gateway. If your problem is decisions that need a trustworthy confidence, use OpenJev in front of it.",
    rows: [
      {
        dimension: "Layer",
        openjev: "The decision itself: typed Choice, Score, Noul",
        other: "Transport: routes prompts to LLM providers",
        edge: "even",
      },
      {
        dimension: "Output",
        openjev: "Typed answer, full distribution, confidence you can calibrate to your labels",
        other: "Whatever the chosen LLM generates",
        edge: "openjev",
      },
      {
        dimension: "Cost per decision",
        openjev: "Local backends cost nothing per call; only escalations reach an LLM",
        other: "Every call is billed at provider rates",
        edge: "openjev",
      },
      {
        dimension: "Provider breadth and failover",
        openjev: "Escalation to one configured LLM provider",
        other: "Many providers with automatic fallbacks",
        edge: "other",
      },
      {
        dimension: "Generation and chat",
        openjev: "Never generates text",
        other: "That is its job",
        edge: "other",
      },
    ],
    whenOther: [
      "You call several LLM providers and want one key, one bill and failover.",
      "The work is generation: chat, summaries, code, long-form answers.",
    ],
    whenOts: [
      "Most of your LLM calls are really classification, routing or yes/no checks.",
      "You want to cut LLM spend by answering the confident cases locally.",
      "You want a gateway as the escalation target, not the default path.",
    ],
    proof: [SHADOW_LINK, LEADERBOARD_LINK],
    code: {
      otherLabel: "Gateway (OpenAI-compatible)",
      other: `const res = await openai.chat.completions.create({
  model: "anthropic/<model>",   // the gateway picks the provider
  messages: [{ role: "user",
    content: "Reply refund, cancel or billing only.\\n" + message }],
});
const intent = res.choices[0].message.content?.trim(); // no confidence`,
      otsLabel: "openjev, gateway as fallback",
      ots: `# .env on the OpenJev server
LLM_PROVIDER=openai
OPENAI_BASE_URL=<your gateway's OpenAI-compatible URL>
OPENAI_API_KEY=<gateway key>

// app code: local first, gateway only for unsure questions
const { answers, escalation } = await client.systemOne({
  model: "auto", state: { message }, questions,
});
console.log(escalation?.escalated); // ids that reached the gateway`,
    },
  },
  {
    slug: "vs-not-diamond",
    title: "openjev vs Not Diamond",
    navLabel: "vs Not Diamond",
    otherLabel: "Not Diamond (model router)",
    otherBlurb:
      "A hosted router that predicts which LLM will answer a given prompt best, so you can send each request to the cheapest or strongest model for it.",
    tagline:
      "Not Diamond picks the best LLM for a prompt. OpenJev skips the LLM when a calibrated local answer is enough.",
    summary:
      "Not Diamond and OpenJev both save money on LLM traffic, in different ways. A model router still sends every request to some LLM; it just picks which one. OpenJev's auto model answers the decision locally, checks the calibrated confidence and the out-of-scope score, and escalates only the questions below your threshold. For open-ended generation a router is the right tool. For closed-set decisions, most calls never need an LLM, and the ones that do are the ones you can name ahead of time.",
    rows: [
      {
        dimension: "What gets routed",
        openjev: "Individual questions, by local confidence",
        other: "Whole prompts, by predicted model quality",
        edge: "even",
      },
      {
        dimension: "Default path",
        openjev: "Local model, no token bill",
        other: "An LLM call on every request",
        edge: "openjev",
      },
      {
        dimension: "Confidence exposed to you",
        openjev: "Calibrated per answer, plus an escalation report",
        other: "A routing choice, not a confidence in the answer",
        edge: "openjev",
      },
      {
        dimension: "Open-ended tasks",
        openjev: "Out of scope; OpenJev never writes text",
        other: "Built for them",
        edge: "other",
      },
      {
        dimension: "Self-hosting",
        openjev: "Apache-2.0, runs on your own hardware",
        other: "Hosted service",
        edge: "openjev",
      },
    ],
    whenOther: [
      "Your traffic is generation and you want the best model per prompt.",
      "You already accept an LLM call per request and want it cheaper or better.",
    ],
    whenOts: [
      "The output is a label, a score or a yes/no.",
      "You want the confident majority of calls answered with no LLM at all.",
      "You need a per-question audit of which answers came from an LLM and why.",
    ],
    proof: [SHADOW_LINK, CALIBRATIONS_LINK],
    code: {
      otherLabel: "Router",
      other: `// 1. Ask the router which model suits this prompt.
// 2. Call that model and parse its text answer.
// Every request still pays for an LLM generation.`,
      otsLabel: "openjev auto",
      ots: OTS_ABSTAIN_SNIPPET,
    },
  },
  {
    slug: "vs-setfit",
    title: "openjev vs SetFit",
    navLabel: "vs SetFit",
    otherLabel: "SetFit (few-shot sentence-transformer classifier)",
    otherBlurb:
      "A Hugging Face library that fine-tunes a sentence-transformer with contrastive learning on a handful of labelled examples per class, then trains a small classification head. Fast and cheap to run once trained.",
    tagline:
      "SetFit trains one classifier per label set. OpenJev answers new label sets with zero training and calibrates from labels when you have them.",
    summary:
      "SetFit is an excellent choice when a label set is stable and you have a few examples per class: training takes minutes and inference is cheap. The cost is one trained model per question, retraining whenever the options change, and probabilities that are not calibrated by default. OpenJev takes the question and options at request time, so a new question or a renamed option needs no training run. Labels still help: upload them and OpenJev fits a calibration map instead of new weights, and shadow mode tells you how it agrees with your current labels. If one frozen label set carries most of your volume and you want the smallest possible model, SetFit is hard to beat.",
    rows: [
      {
        dimension: "Setup per question",
        openjev: "None; options are part of the request",
        other: "Collect examples and train a model per label set",
        edge: "openjev",
      },
      {
        dimension: "Changing the options",
        openjev: "Edit the request",
        other: "Retrain",
        edge: "openjev",
      },
      {
        dimension: "Using your labels",
        openjev: "Fits a calibration map; weights stay shared",
        other: "Fine-tunes the encoder and head",
        edge: "even",
      },
      {
        dimension: "Accuracy on one fixed task with enough examples",
        openjev: "General model, calibrated to your labels",
        other: "Trained on exactly that task, often stronger",
        edge: "other",
      },
      {
        dimension: "Out-of-scope inputs",
        openjev: "ood score and opt-in abstain",
        other: "The head always picks a class",
        edge: "openjev",
      },
      {
        dimension: "Score and yes/no",
        openjev: "Score and Noul are first-class question types",
        other: "Everything is a classification head",
        edge: "openjev",
      },
    ],
    whenOther: [
      "One label set is stable and carries most of your volume.",
      "You have 8 or more good examples per class and can retrain on change.",
      "You want the smallest possible single-purpose model.",
    ],
    whenOts: [
      "You have many questions, or options change often.",
      "You need calibrated confidence and an abstain path, not just a label.",
      "You want to start with zero labels and add calibration once labels arrive.",
    ],
    proof: [LEADERBOARD_LINK, CALIBRATIONS_LINK, SELF_HOST_LINK],
    code: {
      otherLabel: "SetFit",
      other: `from setfit import SetFitModel, Trainer

model = SetFitModel.from_pretrained("sentence-transformers/paraphrase-mpnet-base-v2")
trainer = Trainer(model=model, train_dataset=train_ds)  # labelled examples
trainer.train()                                         # one model per label set
preds = model.predict([message])`,
      otsLabel: "openjev",
      ots: OTS_ABSTAIN_SNIPPET,
    },
  },
];
