/**
 * Trust-layer guides: is Jev calibrated, what happens on out-of-scope input,
 * how to self-host for GDPR / on-prem, and adding confidence to Instructor.
 *
 * Kept apart from guides.ts so that file stays readable; GUIDES spreads these in.
 * Claims about Jev are limited to what independent tests and Jev's own public
 * material say, and every OpenJev claim links to a page you can check
 * (/leaderboard, /calibrations, /shadow).
 */
import type { Guide } from "./guides";

const UPDATED = "2026-09-24";

export const TRUST_GUIDES: readonly Guide[] = [
  {
    slug: "is-jev-calibrated",
    title: "Is Jev calibrated? How to check any decision model's confidence",
    navLabel: "Is Jev calibrated?",
    kind: "trust",
    category: "Trust layer",
    description:
      "What calibration means for Jev-style decision models, why a benchmark score is not your calibration, and how to measure and fix it on your own labels.",
    keywords: [
      "is jev calibrated",
      "jev calibration",
      "jev confidence",
      "decision model calibration",
      "ece brier score",
    ],
    intro:
      'Jev\'s pitch is that its probabilities are trained for decisions, and on public benchmarks it does calibrate better than models whose probabilities are read off a general LLM. That tells you about the benchmark, not about your traffic. Calibration depends on the label set, the wording of your options and the inputs you actually see, so the only honest answer to "is it calibrated?" is to measure it on your own labels.',
    takeaways: [
      "Calibrated means that among answers given 0.8 confidence, about 80% are correct. It is measured, not claimed.",
      "A calibration score from someone else's benchmark does not carry over to your label set or your inputs.",
      "Two numbers summarise it: expected calibration error (ECE, lower is better) and the Brier score (lower is better).",
      "If a model is miscalibrated on your data, a per-question temperature or isotonic map fitted on a few hundred labels usually fixes most of it.",
      "OpenJev publishes ECE and Brier for every backend it can run on /leaderboard, and fits maps on your labels at /calibrations.",
    ],
    sections: [
      {
        heading: "What calibration is, and what it is not",
        body: "Calibration is agreement between stated confidence and observed accuracy. Bucket every answer by its confidence, then compare each bucket's average confidence with how often it was right. A perfectly calibrated model lands on the diagonal. Calibration is separate from accuracy: a model can be accurate and overconfident, which is the case that makes thresholds useless, because 0.95 no longer means 95%.",
      },
      {
        heading: "Why a vendor number is not your number",
        body: "Every published calibration figure, Jev's included, is an average over a benchmark suite. Your questions differ: you might have 40 intents where the benchmark had 5, options that overlap, or inputs in a domain the model has seen little of. Independent tests of Jev-style models show calibration shifting a lot across label sets. Treat any vendor figure as a prior and measure your own.",
      },
      {
        heading: "Measure it in an afternoon",
        body: "Collect a few hundred inputs with the label a person would give. Run them through the model, keep the confidence, and compute ECE and Brier. OpenJev's evals do this for you and draw the reliability chart; any backend it serves can be scored the same way, so you can compare Jev-compatible models on identical data.",
        code: {
          lang: "bash",
          code: `# Create an eval run from labelled cases; the run reports accuracy, ECE and Brier
curl -X POST "$OPENJEV_BASE_URL/api/v1/evals" \\
  -H "authorization: Bearer $OPENJEV_API_KEY" \\
  -H "content-type: application/json" \\
  -d @support-intents-eval.json`,
        },
      },
      {
        heading: "Fix it with your labels instead of a new model",
        body: 'When the reliability curve bends away from the diagonal, you do not need to retrain. Fit a calibration map per question: a single temperature when the curve is uniformly over- or under-confident, isotonic regression when it bends. OpenJev picks the method with method: "auto", stores the map, and applies it when you send calibration_id. The answer then carries calibrated: true so downstream code knows which numbers were remapped.',
        code: {
          lang: "ts",
          code: `const { answers } = await client.systemOne({
  model: "auto",
  state: { message },
  questions: { intent },
  calibration_id: "cal_support_v3", // fitted from your labels
});
answers.intent.calibrated; // true when the map rewrote the confidence`,
        },
      },
      {
        heading: "Keep it calibrated",
        body: "Calibration decays when traffic changes: a new product line, a new language, a seasonal spike. OpenJev keeps the calibration history and a drift monitor for each map, and shadow mode keeps comparing the model with labels or with your current LLM, so a slipping number shows up before a wrong automated decision does.",
      },
    ],
    table: {
      caption: "What to trust, and where it comes from",
      colA: "Signal",
      colB: "How to get it for your data",
      rows: [
        { label: "Accuracy", a: "Top answer right or wrong", b: "Eval run on labelled examples" },
        {
          label: "ECE",
          a: "Average gap between confidence and accuracy",
          b: "Same eval run, reliability chart",
        },
        { label: "Brier", a: "Squared error of the probabilities", b: "Same eval run" },
        {
          label: "Drift",
          a: "Change in the above over time",
          b: "Calibration drift monitor and shadow mode",
        },
      ],
    },
    faqs: [
      {
        q: "Is Jev calibrated?",
        a: "Better than most open alternatives on public benchmarks, by its own and independent measurements. Whether it is calibrated on your questions is something only your labels can answer; measure ECE on a few hundred of them.",
      },
      {
        q: "How many labels do I need?",
        a: "A few hundred per question gives a stable ECE estimate and enough data for a temperature fit. Isotonic maps want more, roughly a thousand, because they fit a curve rather than one number.",
      },
      {
        q: "Can I calibrate a model I do not host?",
        a: "Yes. Calibration is applied to the returned probabilities, so a map can be fitted for any backend OpenJev serves. The map is tied to the model it was fitted on and is skipped, with a reason, if you send it with a different model.",
      },
    ],
    related: [
      { kind: "page", slug: "/leaderboard", label: "ECE and Brier for every backend" },
      { kind: "page", slug: "/calibrations", label: "Fit a calibration map" },
      { kind: "guide", slug: "confidence-calibration", label: "Calibrated confidence, explained" },
      { kind: "compare", slug: "vs-jev", label: "openjev vs the hosted cloud" },
    ],
    updated: UPDATED,
  },
  {
    slug: "jev-out-of-scope-inputs",
    title: "Jev on out-of-scope inputs: why decision models guess, and how to make them abstain",
    navLabel: "Jev on out-of-scope inputs",
    kind: "trust",
    category: "Trust layer",
    description:
      "Typed decision models must pick one of your options, even when the input fits none. What that costs, how to detect it, and how opt-in abstain fixes it.",
    keywords: [
      "jev out of scope",
      "jev hallucination",
      "out of distribution detection",
      "llm abstain",
      "none of the above classification",
    ],
    intro:
      'A typed decision always returns one of your options. That is the feature: no parsing and no invented labels. It is also the trap. Ask a support-intent question about a pizza recipe and a Jev-style model still picks an intent, often with high confidence, because "none of these" was never on the menu. Independent testing of Jev-style models found out-of-scope inputs almost never flagged. OpenJev scores every answer for scope and lets any question say "I don\'t know".',
    takeaways: [
      'A closed answer set has no "none of the above" unless you add one, so off-topic input is forced into a real label.',
      "High confidence on an off-topic input is the dangerous case: it passes any confidence threshold you set.",
      "OpenJev attaches an ood score from 0 to 1 to every answer, on every backend, and damps confidence on out-of-scope input.",
      "Send abstain: true (or abstain_below) and the answer comes back with abstained: true and the reserved __none__ label instead of a guess.",
      "The leaderboard reports each backend's flag rate and confidently-wrong rate, including on CLINC150's public out-of-scope queries.",
      "Near-domain out-of-scope queries are harder than off-topic ones; pair abstain with calibration and the auto cascade.",
    ],
    sections: [
      {
        heading: "Why decision models guess",
        body: 'A decision model scores your options against the input and normalises the scores into probabilities that sum to one. If every option is a poor fit, the least-bad one still wins, and normalisation can make it look decisive. A general LLM would at least be able to write "this is not a support request"; a typed decision cannot, unless the interface gives it a way.',
      },
      {
        heading: "Two signals that catch it",
        body: "OpenJev combines distance and entropy. Distance measures how far the input is from the question's own vocabulary: the instructions and every option description. Entropy measures how flat the distribution is. Distance dominates, because a peaked distribution on a distant input is exactly the confident mistake you want to catch. Both are backend-agnostic, so a Laya answer, a native-engine answer and an otsone-1 answer all get the same check.",
      },
      {
        heading: "Opt into abstain",
        body: "Abstention is opt-in so that existing clients see the classic wire format unchanged. Turn it on per question or for the whole request. An abstained Choice returns the reserved __none__ label; every type carries abstained, abstain_reason (out_of_scope or low_confidence) and p_none.",
        code: {
          lang: "ts",
          code: `const { answers } = await client.systemOne({
  state: "How long do I bake focaccia?",
  questions: {
    intent: { ...choice("Support intent?", { refund: null, cancel: null, billing: null }),
              abstain: true },
  },
});

if (answers.intent.abstained) {
  // answers.intent.choice === "__none__"
  // answers.intent.abstain_reason === "out_of_scope"
  routeToGeneralInbox();
}`,
        },
      },
      {
        heading: "Pair it with the auto cascade",
        body: 'With model: "auto", an abstained or out-of-scope question is escalated to your configured LLM rather than dropped, and the response lists which questions escalated and why. You pay for an LLM call only on the inputs that genuinely need one.',
      },
      {
        heading: "Where it falls short",
        body: "The scope score is strongest on clearly off-topic input: a recipe question sent to a support-intent classifier. It is weaker on near-domain queries that share vocabulary with your options, such as the out-of-scope set in CLINC150, where an unanswerable banking question looks a lot like a real one. The leaderboard's CLINC150 track shows this openly for the local engines. For those cases, fit a calibration on your own labels, raise abstain_below, and use the auto cascade so unsure answers reach an LLM instead of being acted on.",
      },
      {
        heading: "Measure it on public data",
        body: "The OpenJev leaderboard runs every backend it can reach over an in-repo out-of-scope probe set and over CLINC150's public out-of-scope test queries. It reports how often each backend flags the input (higher is better), how often it answers at 0.9 confidence or more anyway (lower is better), and on CLINC150 the flag rate at a 5% false-alarm rate on in-scope queries. The harness is in the repo, so you can re-run it on your own hardware and add your own backends.",
      },
    ],
    faqs: [
      {
        q: "Does Jev abstain on out-of-scope inputs?",
        a: "The Jev wire format has no abstain field, so a Jev answer always names one of your options. You can detect some cases by thresholding confidence, but confident out-of-scope answers slip through. OpenJev adds the ood score and abstain on top of any backend it serves.",
      },
      {
        q: "Will abstain lower my accuracy on normal inputs?",
        a: "It trades coverage for precision. Start with the default floor, look at what abstained in your eval run, and move abstain_below until the abstained set is mostly genuine out-of-scope input.",
      },
      {
        q: 'Can I add my own "other" option instead?',
        a: 'You can, and it helps when "other" is a real category. It does not replace abstain: the model still has to recognise the input as other, while the ood score does not depend on the model at all.',
      },
    ],
    related: [
      { kind: "page", slug: "/leaderboard", label: "Out-of-scope flag rate per backend" },
      { kind: "page", slug: "/shadow", label: "Shadow mode on your traffic" },
      { kind: "guide", slug: "is-jev-calibrated", label: "Is Jev calibrated?" },
      { kind: "compare", slug: "vs-laya", label: "openjev vs Laya" },
    ],
    updated: UPDATED,
  },
  {
    slug: "self-hosted-jev-alternative-gdpr-on-prem",
    title: "A self-hosted Jev alternative for GDPR and on-prem deployments",
    navLabel: "Self-hosted Jev for GDPR / on-prem",
    kind: "trust",
    category: "Trust layer",
    description:
      "Run Jev-compatible typed decisions on your own servers so personal data never leaves them: what to deploy, which backend to pick and what stays your responsibility.",
    keywords: [
      "self-hosted jev alternative",
      "jev gdpr",
      "on-prem decision model",
      "jev on premise",
      "air-gapped llm classification",
    ],
    intro:
      "Hosted decision APIs send every input to a third party. For support tickets, health notes or anything with personal data, that makes the vendor a processor under GDPR and turns every new use case into a data-protection review. OpenJev is Apache-2.0 and speaks the same /v1/systemone wire format as Jev, so you can run it inside your own network and keep the inputs there.",
    takeaways: [
      "Same request and response shape as Jev: existing clients change their base URL, not their code.",
      "Local backends (native engine, laya-onnx on CPU, laya-mlx on Apple Silicon, otsone-1) answer without any outbound call.",
      "The auto cascade and the any-LLM backend are the only features that call out, and both are off unless you configure an LLM.",
      "Self-hosting removes a processor; it does not make you compliant by itself. Retention, access control and a lawful basis are still yours.",
      "Calibration, shadow mode, abstain and the leaderboard harness all run self-hosted, with no licence key.",
    ],
    sections: [
      {
        heading: "What leaves the box, and what does not",
        body: "On a local backend, a decision is computed in-process or in a local sidecar. The state you send, the questions and the answers stay in your network. Request logs and decision history are written to your own Postgres (or the embedded PGlite for a single node). Nothing is sent to OpenJev's authors. If you set an LLM provider for the auto cascade, only the questions that escalate are sent to that provider, and the response tells you which ones did.",
        bullets: [
          "Local only: native, laya-onnx, laya-mlx, otsone-1.",
          "Outbound, opt-in: auto escalation and the any-LLM backend, to the provider you configure.",
          "Point OPENAI_BASE_URL at a model you host yourself to keep escalations on-prem too.",
        ],
      },
      {
        heading: "A minimal on-prem deployment",
        body: "One container for the API and console, one Postgres, and optionally the Laya sidecar. The SELF-HOSTING.md file in the repo lists every environment variable. With the LLM keys left empty, decisions never leave the host.",
        code: {
          lang: "bash",
          code: `git clone https://github.com/caelum0x/openjev && cd openjev
cp .env.example .env         # optional DATABASE_URL; leave LLM keys empty to stay local
npm ci && npm run build:node # applies migrations too
npm run serve                # POST /api/v1/systemone on your own host`,
        },
      },
      {
        heading: "Pick a backend for your hardware",
        body: "laya-onnx runs on plain x86_64 CPUs and is the production default on Linux. laya-mlx is fastest on Apple Silicon. The native engine has no model download at all, which suits air-gapped networks where pulling weights is a change-control ticket. Score them on your own labels before you choose: the leaderboard harness and the evals page run the same data through each.",
      },
      {
        heading: "What GDPR still asks of you",
        body: "Self-hosting removes a third-party processor from the flow, which simplifies your records of processing and removes a transfer question. It does not choose a lawful basis, set retention, or answer access requests for you. Configure log retention to match your policy, restrict console access, and document the decision logic if decisions have legal or similarly significant effects on people, where Article 22 applies.",
      },
    ],
    table: {
      caption: "Hosted decision API vs self-hosted OpenJev",
      colA: "Hosted API",
      colB: "Self-hosted OpenJev",
      rows: [
        { label: "Where inputs are processed", a: "Vendor cloud", b: "Your servers" },
        { label: "Processor agreement", a: "Needed with the vendor", b: "Not for local backends" },
        { label: "Outbound calls", a: "Every request", b: "None by default; escalation is opt-in" },
        { label: "Ops work", a: "None", b: "You run and patch it" },
      ],
    },
    faqs: [
      {
        q: "Is OpenJev GDPR compliant?",
        a: "Software is not compliant on its own; deployments are. What OpenJev gives you is the ability to process decisions without sending personal data to a third party, and to control where logs live and how long they are kept.",
      },
      {
        q: "Can it run fully air-gapped?",
        a: "Yes, on the native engine with no model download, or on Laya/otsone-1 once the weights are copied in. Leave the LLM provider unset and the server makes no outbound calls.",
      },
      {
        q: "Do my Jev clients work unchanged?",
        a: "They send the same /v1/systemone request, so pointing the SDK's base URL at your server is the migration. Model ids differ: send one of the backends your server exposes, or auto.",
      },
    ],
    related: [
      { kind: "page", slug: "/self-hosting", label: "Self-hosting guide" },
      { kind: "page", slug: "/leaderboard", label: "Compare backends before you pick" },
      { kind: "doc", slug: "self-hosting", label: "Self-hosting reference" },
      { kind: "compare", slug: "vs-jev", label: "openjev vs the hosted cloud" },
    ],
    updated: UPDATED,
  },
  {
    slug: "instructor-confidence-in-3-lines",
    title: "Add confidence to Instructor in 3 lines",
    navLabel: "Instructor + confidence",
    kind: "migration",
    category: "Migration",
    description:
      "Keep your Instructor response_model and get calibrated probabilities and an abstain flag for every Literal, bool and bounded int field, with no generation.",
    keywords: [
      "instructor confidence score",
      "instructor response_model probability",
      "pydantic literal confidence",
      "instructor alternative",
      "llm classification confidence python",
    ],
    intro:
      "Instructor made response_model the habit: describe the output as a Pydantic model and get a validated instance back. For decision fields (Literal labels, yes/no flags, 0 to 4 ratings) it cannot tell you how sure the model was. The openjev-adapters Instructor bridge takes the same Pydantic model, answers it through OpenJev, and returns the instance plus the confidence behind every field.",
    takeaways: [
      "Same response_model, same messages: the call shape mirrors client.chat.completions.create.",
      "Literal and Enum fields become Choice questions, bool becomes Noul, bounded int becomes Score.",
      "Every field gets a confidence and a full probability distribution in the returned report.",
      "Optional fields can abstain and come back as None; required fields that abstain raise AbstainedError instead of guessing.",
      "Free-text fields stay with Instructor: the bridge refuses them rather than inventing text.",
    ],
    sections: [
      {
        heading: "The three lines",
        body: "Install openjev-adapters, point it at an OpenJev server with OPENJEV_BASE_URL (self-hosted or hosted), and swap the Instructor client for the bridge on your decision models.",
        code: {
          lang: "python",
          code: `from openjev_adapters.instructor import from_openjev
client = from_openjev()
ticket, report = client.chat.completions.create_with_confidence(response_model=Ticket, messages=messages)`,
        },
      },
      {
        heading: "The model you already have",
        body: "Nothing about the Pydantic model changes. Field descriptions become the question text; option and level descriptions come from json_schema_extra if you want to add them.",
        code: {
          lang: "python",
          code: `from typing import Literal
from pydantic import BaseModel, Field

class Ticket(BaseModel):
    category: Literal["refund", "cancel", "billing"] = Field(description="Main request")
    urgent: bool
    severity: int = Field(ge=0, le=3)
    topic: Literal["shipping", "account"] | None = None  # may abstain

report.confidence["category"]     # 0.91
report.probabilities["category"]  # {"refund": 0.91, "cancel": 0.06, "billing": 0.03}
report.abstained                  # ("topic",) when the input fits neither topic
report.below(0.7)                 # fields to send to a human`,
        },
      },
      {
        heading: "Gate on the report",
        body: 'Because each field has its own confidence, you can automate the sure fields and ask about the rest. Add calibration_id to use a map fitted on your own labels, and model="auto" to have unsure fields re-asked to an LLM automatically.',
        code: {
          lang: "python",
          code: `ticket, report = client.create_with_confidence(
    Ticket, messages=messages, model="auto", calibration_id="cal_support_v3")

if report.below(0.8):
    queue_for_review(ticket, report.below(0.8))
else:
    apply(ticket)`,
        },
      },
      {
        heading: "When to keep plain Instructor",
        body: "Keep Instructor for extraction: names, addresses, summaries, nested lists. Those need generation, and the bridge deliberately does not generate. A common split is one Instructor model for extracted fields and one bridge model for the decisions about them.",
      },
    ],
    faqs: [
      {
        q: "Does this need the instructor package?",
        a: "No. The bridge only needs pydantic and the openjev SDK; it mirrors Instructor's call shape so your code reads the same.",
      },
      {
        q: "Are the probabilities calibrated?",
        a: "They are the decision model's probabilities, with out-of-scope damping. Pass calibration_id to apply a map fitted on your labels, which is what makes a threshold mean the same thing week to week.",
      },
      {
        q: "Is there an async version?",
        a: "Yes: from_openjev_async() returns the same API with await.",
      },
    ],
    related: [
      { kind: "compare", slug: "vs-instructor", label: "openjev vs Instructor" },
      { kind: "guide", slug: "is-jev-calibrated", label: "Is Jev calibrated?" },
      { kind: "page", slug: "/calibrations", label: "Fit a calibration map" },
      { kind: "guide", slug: "replace-llm-json-mode", label: "Migrating off JSON mode" },
    ],
    updated: UPDATED,
  },
];
