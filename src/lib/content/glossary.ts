/**
 * GLOSSARY — content behind /glossary.
 *
 * Canonical definitions for every term a new user of OpenJev will encounter.
 * Covers the three primitives, calibration metrics, engine concepts, backends,
 * the protocol, and the SDK — with cross-links between related terms.
 *
 * Data only — no JSX. The glossary route renders terms in alphabetical order
 * and anchors each by its slug.
 */

export interface GlossaryTerm {
  /** URL-safe slug, also used as the anchor id: /glossary#<slug>. */
  readonly slug: string;
  /** Display term (may differ from slug). */
  readonly term: string;
  /** One-line definition for cards and previews. */
  readonly short: string;
  /** Full explanation — two to four sentences. */
  readonly body: string;
  /** Slugs of related terms shown as cross-links. */
  readonly seeAlso: readonly string[];
}

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    slug: "any-llm",
    term: "any-LLM backend",
    short: "Wraps a hosted chat model as a System One backend.",
    body: "The any-LLM backend adapts a cloud chat model (OpenAI, Anthropic, or any OpenAI-compatible endpoint) to serve typed decisions by formatting the state and questions as a structured prompt and parsing the response into the Choice / Score / Noul contract. It is the right choice when you need a hosted model's language understanding and can accept higher latency and per-token cost. All five backends expose the same POST /api/v1/systemone interface.",
    seeAlso: ["backend", "laya-mlx", "laya-onnx", "native-scorer", "system-one"],
  },
  {
    slug: "backend",
    term: "backend",
    short: "The execution engine that evaluates a typed decision.",
    body: "A backend is the component that scores the closed answer set given the state and questions. OpenJev ships five: laya-mlx (Apple-silicon MLX), laya-onnx (portable ONNX, the CPU-production default), native scorer (zero model download), local (a server you run), and any-LLM (a hosted chat model). The request format never changes across backends — switching is a configuration change, not a code change.",
    seeAlso: ["laya-mlx", "laya-onnx", "native-scorer", "system-one"],
  },
  {
    slug: "brier-score",
    term: "Brier score",
    short: "Mean squared error between confidence and correctness.",
    body: "The Brier score is the mean of (confidence − correct)² across all predictions, where correct is 1 for a correct top answer and 0 otherwise. Lower is better. A perfect score is 0 (confidence = 1 on every correct prediction, 0 on every wrong one); a random baseline on a binary question scores 0.25. The Brier score measures both calibration and resolution together, so it penalizes both over-confident wrong answers and under-confident correct ones.",
    seeAlso: ["calibration", "ece", "mce", "reliability-diagram"],
  },
  {
    slug: "calibration",
    term: "calibration",
    short: "The property that a 0.8 confidence is right roughly 80% of the time.",
    body: "A decision system is calibrated when its stated confidence matches empirical accuracy: among all predictions labelled 0.7, approximately 70% are correct. Most LLM self-reported confidence scores are not calibrated — they track how certain the answer sounds, not how often it is right. openjev's confidence comes from the engine's distribution over the closed answer set, measured against a labelled gold suite, so the number is comparable across calls and meaningful to threshold.",
    seeAlso: ["ece", "mce", "brier-score", "reliability-diagram", "temperature-scaling"],
  },
  {
    slug: "choice",
    term: "Choice",
    short: "Closed-set classification primitive — returns one label from a named set.",
    body: "Choice is the classifier primitive in openjev. You give it a question and a map of 2–255 labelled options (each with a short description), and it returns the winning label, a probability for every option, and a calibrated confidence. Because the answer space is enumerated in advance, the output is always valid — there is no parsing step and no retry-until-it-parses loop. Options can also declare exclusions to sharpen contrastive scoring.",
    seeAlso: ["score", "noul", "distribution", "confidence", "closed-set-classification", "contrastive-scoring"],
  },
  {
    slug: "closed-set-classification",
    term: "closed-set classification",
    short: "Classification where all valid answers are enumerated in advance.",
    body: "In closed-set classification the caller defines the complete set of acceptable answers before evaluation. All three OpenJev primitives are closed-set by design: Choice enumerates labels, Score enumerates rubric levels, and Noul constrains the answer to a probability in [0,1] for a single proposition. Constraining the answer space produces a valid-by-construction output, enables a full distribution, and allows calibrated confidence — none of which a free-text response gives you without post-processing.",
    seeAlso: ["choice", "score", "noul", "distribution"],
  },
  {
    slug: "confidence",
    term: "confidence",
    short: "Calibrated scalar in [0,1] indicating certainty in the top answer.",
    body: "The confidence returned with every typed decision is the engine's probability that the top answer is correct. It is computed from the engine's distribution over the closed answer set, not sampled from the model's language-generation head. You can set a threshold on it to auto-act on the confident majority, escalate the borderline minority, and route the very uncertain to a human — a three-way split that replaces a binary 'trust it or not'. How well it is calibrated varies by backend and data: ECE on public datasets is on the /leaderboard page, and a calibration fitted on your own labels reports held-out ECE.",
    seeAlso: ["calibration", "distribution", "choice", "score", "noul"],
  },
  {
    slug: "contrastive-scoring",
    term: "contrastive scoring",
    short: "Scoring each option against the others under the same state.",
    body: "Contrastive scoring evaluates each option by asking how well it fits the state relative to the alternatives, rather than scoring each option in isolation. This produces sharper probability distributions — the mass between close options is reduced — and makes option descriptions more powerful: describing what distinguishes an option from its neighbours is more useful to the scorer than describing what the option is in absolute terms.",
    seeAlso: ["choice", "distribution", "confidence"],
  },
  {
    slug: "distribution",
    term: "distribution",
    short: "Full probability mass across all options returned with every decision.",
    body: "Every Choice and Score in OpenJev returns not just the top answer but the complete probability distribution across all options. The distribution is where most ambiguity lives: a 0.52 / 0.48 split between two options is genuine uncertainty, not a confident answer. Surfacing the runner-up to a reviewer turns a hard classification into a fast human confirmation. For Score, adjacent levels sharing mass signals a rating sitting on a rubric boundary.",
    seeAlso: ["confidence", "choice", "score", "calibration"],
  },
  {
    slug: "ece",
    term: "ECE (Expected Calibration Error)",
    short: "Weighted mean of |accuracy − confidence| across confidence buckets.",
    body: "ECE bins predictions by confidence into equal-width buckets, computes |empirical accuracy − mean confidence| in each bucket, and takes the weighted mean across buckets. A perfectly calibrated system has ECE = 0. ECE is the primary calibration metric reported by openjev's harness; lower values mean the confidence numbers are more trustworthy as thresholds. OpenJev also reports MCE (worst-case bucket error) and Brier score alongside ECE.",
    seeAlso: ["calibration", "mce", "brier-score", "reliability-diagram"],
  },
  {
    slug: "gold-suite",
    term: "gold suite",
    short: "Labelled test suite used to measure calibration and accuracy per profile.",
    body: "The gold suite is a set of 93 curated cases with ground-truth labels covering all three question types (Choice, Score, Noul) across multiple domain feature axes. It is the data source for openjev's calibration harness: running the suite through the engine produces the ECE, MCE, and Brier scores that appear on the models page. Because the engine was tuned on it, the gold suite is a regression check rather than a held-out benchmark; public-dataset results are on the /leaderboard page. Callers can extend the gold suite with domain-specific cases to measure calibration on their own data.",
    seeAlso: ["calibration", "ece", "tuning-profile"],
  },
  {
    slug: "isotonic-regression",
    term: "isotonic regression",
    short: "Post-processing technique that fits a monotonic calibration map.",
    body: "Isotonic regression is a post-processing calibration method that learns a monotone non-decreasing function from raw model confidence to empirical accuracy on a held-out set. Unlike temperature scaling, which has one degree of freedom (a single scalar), isotonic regression can correct non-monotone miscalibration patterns. openjev's calibration harness provides the reliability binning infrastructure; isotonic regression can be applied as a post-processing step on the harness output.",
    seeAlso: ["calibration", "temperature-scaling", "ece", "reliability-diagram"],
  },
  {
    slug: "jev",
    term: "otsone / jev model alias",
    short: "Our neural decision model; jev-* aliases preserved for wire compatibility.",
    body: "The jev-v13 and jev-latest aliases refer to tuning profiles of the OpenJev engine. They are preserved as wire-compat aliases so existing integrations keep working without code changes. The underlying model is the same deterministic engine with different scalar weights. For new integrations prefer openjev-latest or system-one.",
    seeAlso: ["system-one", "typesafe-protocol", "tuning-profile"],
  },
  {
    slug: "laya-mlx",
    term: "laya-mlx",
    short: "Apple-silicon inference backend using Apple's MLX framework.",
    body: "laya-mlx is the OpenJev backend that runs the decision model on Apple-silicon hardware (M-series Macs) via the MLX framework. It is the fastest backend in that environment. It requires Apple silicon and is not available on Linux or x86. For portable cross-platform deployments use laya-onnx instead.",
    seeAlso: ["laya-onnx", "native-scorer", "backend"],
  },
  {
    slug: "laya-onnx",
    term: "laya-onnx",
    short: "Portable ONNX runtime backend; the CPU-production default.",
    body: "laya-onnx runs the decision model via the ONNX runtime, which supports Linux, macOS, and Windows on both x86 and ARM64 with no GPU required. It is the default backend in the openjev/engine Docker image and the recommended choice for production server deployments. Its results are consistent across platforms and hardware generations.",
    seeAlso: ["laya-mlx", "native-scorer", "backend"],
  },
  {
    slug: "mce",
    term: "MCE (Maximum Calibration Error)",
    short: "Worst-case calibration error across non-empty confidence buckets.",
    body: "MCE is the largest |accuracy − mean confidence| across all non-empty buckets in the reliability diagram. Where ECE gives an average view, MCE surfaces the worst region — the confidence band where the model is most misleading. A low ECE with a high MCE indicates concentrated miscalibration in one part of the confidence range, often the high-confidence tail.",
    seeAlso: ["ece", "calibration", "reliability-diagram", "brier-score"],
  },
  {
    slug: "native-scorer",
    term: "native scorer",
    short: "Built-in lexical and contrastive decision engine; no model download.",
    body: "The native scorer is the zero-dependency decision engine built into openjev. It requires no external model file, answers with no network call, and produces fully deterministic results. It trades some accuracy against natural-language edge cases for a fast local judgment that needs no setup. It is the right choice for high-volume, latency-critical applications that do not require deep language understanding.",
    seeAlso: ["laya-onnx", "laya-mlx", "backend", "contrastive-scoring"],
  },
  {
    slug: "noul",
    term: "Noul",
    short: "Yes/no primitive — returns a calibrated P(yes) in [0,1].",
    body: "Noul is the single-proposition primitive. For a yes/no question it returns a calibrated probability that the proposition is true, not a coin flip. It is the workhorse for gates, guardrail checks, and compliance items: cheap, deterministic, and thresholdable. Batch many Nouls over one shared state to turn a compliance checklist into a single POST call. Setting the threshold per use case means you control how strict the gate is — strict for irreversible actions, loose for cheap-to-undo ones.",
    seeAlso: ["choice", "score", "confidence", "calibration", "closed-set-classification"],
  },
  {
    slug: "question",
    term: "question",
    short: "One typed query — a choice(), score(), or noul() — attached to a request.",
    body: "A question is the unit of a typed decision: a prompt string plus a primitive type and its parameters (the option map for Choice, the range for Score, the proposition for Noul). Questions are attached as a map to a systemone request; they are evaluated independently against the shared state, and answers come back under the same keys. You can attach up to 64 questions per request.",
    seeAlso: ["state", "choice", "score", "noul", "system-one"],
  },
  {
    slug: "reliability-diagram",
    term: "reliability diagram",
    short: "Chart of empirical accuracy vs. average confidence per bucket.",
    body: "A reliability diagram plots, for each confidence bucket, the mean model confidence on the x-axis and the empirical accuracy on the y-axis. A perfectly calibrated model's line lies on the diagonal. Points above the diagonal mean the model is under-confident in that bucket; points below mean over-confidence. openjev's calibration harness computes the data for this diagram via buildReliability().",
    seeAlso: ["calibration", "ece", "mce", "brier-score"],
  },
  {
    slug: "score",
    term: "Score",
    short: "Ordered-rubric primitive — returns one level on a 2–10 level scale.",
    body: "Score is the rubric primitive. You give it a question and a range (e.g. 0–5 or 1–4), and it returns one level, a calibrated confidence, and a distribution over the levels. Score understands that the levels are ordered — a 4 is closer to a 5 than to a 1 — which makes adjacent-level distribution splits meaningful: mass split between levels 3 and 4 is a borderline rating near a threshold. Use Score for severity, urgency, quality, and risk; use Choice for unordered categories.",
    seeAlso: ["choice", "noul", "distribution", "confidence", "calibration"],
  },
  {
    slug: "state",
    term: "state",
    short: "The shared context read once against all questions in a request.",
    body: "The state is the JSON object you pass alongside the questions in a POST /api/v1/systemone call. Every question in the request is evaluated against the same state, which is read once regardless of how many questions are attached. The state is arbitrary JSON — a ticket object, a document string, a user profile, a candidate code snippet — whatever the questions need to make their judgments against.",
    seeAlso: ["question", "system-one"],
  },
  {
    slug: "system-one",
    term: "System One",
    short: "The request contract and default model id for openjev.",
    body: "System One is both the name of the default tuning profile (model id: system-one) and the name of the request contract. Named after Kahneman's fast, intuitive reasoning mode, it is designed for the small, high-volume judgments in a pipeline — which bucket, how severe, is-this-allowed — not for slow deliberative reasoning. OpenJev is wire-compatible with the upstream System One v1 API protocol.",
    seeAlso: ["jev", "typesafe-protocol", "tuning-profile", "question", "state"],
  },
  {
    slug: "temperature-scaling",
    term: "temperature scaling",
    short: "Single-parameter calibration that divides logits by a learned temperature T.",
    body: "Temperature scaling is the simplest post-processing calibration technique: it divides the pre-softmax logits by a single scalar T learned on a held-out validation set. T > 1 softens the distribution (reduces overconfidence); T < 1 sharpens it (reduces underconfidence). It preserves the ranking of predictions while improving calibration. openjev's engine scalars include a tempScale parameter that plays a similar role in the native decision engine.",
    seeAlso: ["calibration", "isotonic-regression", "ece", "reliability-diagram"],
  },
  {
    slug: "tuning-profile",
    term: "tuning profile",
    short: "A named set of engine scalar weights that produces a distinct behavior.",
    body: "A tuning profile is one configuration of scalar weights in the OpenJev engine (tempScale, dist, peakedBlend, neg, and others). The four built-in profiles are: system-one (balanced calibrated default), jev-v13 (sharper top-mass, alias preserved for wire compat), decisive (high-confidence bias), and contrastive (maximum option separation). They are not separately trained models; they are the same deterministic engine run with different scalars, evaluated against the gold suite for honest ECE and accuracy numbers.",
    seeAlso: ["system-one", "jev", "gold-suite", "calibration"],
  },
  {
    slug: "typesafe-protocol",
    term: "System One v1 wire protocol",
    short: "The request / response contract implemented by openjev.",
    body: "The System One v1 wire protocol defines the field names, primitive types, and response shape for a /v1/systemone request. OpenJev implements this protocol, so any payload that works against the self-hosted engine works against any compatible endpoint. Switching between self-hosted and hosted is a URL change — no payload changes, no SDK changes.",
    seeAlso: ["jev", "system-one"],
  },
];

/** Glossary terms sorted alphabetically by display term. */
export const GLOSSARY_SORTED: readonly GlossaryTerm[] = [...GLOSSARY].sort(
  (a, b) => a.term.localeCompare(b.term),
);

/** Look up a term by slug. */
export function termBySlug(slug: string): GlossaryTerm | undefined {
  return GLOSSARY.find((t) => t.slug === slug);
}
