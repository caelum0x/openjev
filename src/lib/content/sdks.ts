/**
 * SDKS — the content behind /sdks and /sdks/$slug.
 *
 * Five SDK / interface guides covering every way to call openjev:
 *   javascript  — @caelum/typesafe (the official TypeScript/Node SDK)
 *   python      — OpenJev (server-backed Python client)
 *   python-adapter — OpenJev (client-side LLM-backed, no server)
 *   rest-api    — raw HTTP POST /v1/systemone via curl or fetch
 *   cli         — scripts/cli.mjs serve / laya-download / decide
 *
 * Real API shapes throughout: POST /v1/systemone {model, state, questions:{name:{type,
 * instructions, options?}}} → {answers:{name:{type, choice|score|noul, probabilities,
 * confidence}}}. Data only — no JSX.
 */

export type SdkKind = "official" | "http" | "cli";

export interface SdkSection {
  readonly heading: string;
  readonly body: string;
  readonly bullets?: readonly string[];
  readonly code?: { readonly lang?: string; readonly code: string };
}

export interface SdkFAQ {
  readonly q: string;
  readonly a: string;
}

export interface SdkTableRow {
  readonly label: string;
  readonly a: string;
  readonly b: string;
}

export interface SdkTable {
  readonly caption: string;
  readonly colA: string;
  readonly colB: string;
  readonly rows: readonly SdkTableRow[];
}

export interface SdkRelated {
  readonly kind: "sdk" | "guide" | "compare" | "use-case" | "doc";
  readonly slug: string;
  readonly label: string;
}

export interface SdkGuide {
  /** URL slug — /sdks/$slug */
  readonly slug: string;
  /** H1 / page title. */
  readonly title: string;
  /** Short label for cards and nav. */
  readonly navLabel: string;
  readonly kind: SdkKind;
  /** Domain label shown mono-uppercase, e.g. "Official SDK". */
  readonly category: string;
  /** ~150-char meta description. */
  readonly description: string;
  /** Target search keywords for JSON-LD + internal relevance. */
  readonly keywords: readonly string[];
  /** 2–3 sentence intro under the H1. */
  readonly intro: string;
  /** Scannable key takeaways for the TL;DR block. */
  readonly takeaways: readonly string[];
  /** The substantive body. */
  readonly sections: readonly SdkSection[];
  /** Optional comparison table. */
  readonly table?: SdkTable;
  /** Page-specific FAQ (drives FAQPage JSON-LD). */
  readonly faqs: readonly SdkFAQ[];
  /** Curated cross-links. */
  readonly related: readonly SdkRelated[];
  /** ISO date for Article dateModified. */
  readonly updated: string;
}

const UPDATED = "2026-09-23";

export const SDKS: readonly SdkGuide[] = [
  // ── Official SDKs ─────────────────────────────────────────────────────────
  {
    slug: "javascript",
    title: "@caelum/typesafe — the official JavaScript & TypeScript SDK",
    navLabel: "JavaScript / TypeScript",
    kind: "official",
    category: "Official SDK",
    description:
      "Install and use @caelum/typesafe in Node, Bun, or Deno: initialise the client, call systemOne with Choice, Score, and Noul questions, and handle typed responses and errors.",
    keywords: [
      "caelum typesafe sdk",
      "openjev javascript",
      "typesafe npm",
      "typed llm decisions typescript",
      "systemone javascript",
    ],
    intro:
      "@caelum/typesafe is the official TypeScript-first client for openjev. It ships three typed question builders — choice(), score(), noul() — and a single client.systemOne() method that sends them over POST /v1/systemone and returns a fully-typed answer map. It runs in Node 18+, Bun, and Deno, and targets any openjev-compatible endpoint.",
    takeaways: [
      "One package — @caelum/typesafe — covers install, client init, and all three primitives.",
      "choice(), score(), and noul() build typed questions; client.systemOne() sends them and returns typed answers.",
      "The client respects OPENJEV_BASE_URL and OPENJEV_API_KEY from the environment.",
      "TypeSafeError carries the HTTP status and server message for structured catch branches.",
    ],
    sections: [
      {
        heading: "Installation",
        body: "Install from npm. The package is ESM-first and ships TypeScript declarations — no separate @types package needed.",
        code: {
          lang: "bash",
          code: `# npm
npm install @caelum/typesafe

# pnpm
pnpm add @caelum/typesafe

# Bun
bun add @caelum/typesafe`,
        },
      },
      {
        heading: "Initialising the client",
        body: "Create one TypeSafeClient per process. baseURL defaults to the OPENJEV_BASE_URL environment variable; apiKey defaults to OPENJEV_API_KEY. You can override either in the constructor, and set a default model that every call inherits unless overridden.",
        code: {
          lang: "ts",
          code: `import { TypeSafeClient } from "@caelum/typesafe";

// Reads OPENJEV_BASE_URL and OPENJEV_API_KEY from the environment.
export const client = new TypeSafeClient();

// Or supply them explicitly:
export const client = new TypeSafeClient({
  baseURL: "http://localhost:3000",
  apiKey: process.env.TYPESAFE_KEY!,
  model: "laya-onnx", // default model for every call
  timeoutMs: 10_000,  // default 30 000
});`,
        },
      },
      {
        heading: "Core method: systemOne",
        body: "client.systemOne() takes a state object (any JSON-serialisable value that describes the context) and a map of typed questions. Each question is built with choice(), score(), or noul(). The return type mirrors the question map: if you asked category as a Choice and severity as a Score, answers.category is a ChoiceAnswer and answers.severity is a ScoreAnswer.",
        code: {
          lang: "ts",
          code: `import { TypeSafeClient, choice, score, noul } from "@caelum/typesafe";

const client = new TypeSafeClient();

const { answers } = await client.systemOne({
  state: { ticket: "My order was charged twice and I'm furious." },
  questions: {
    category: choice("What does the sender of ticket want?", {
      refund: "Wants money returned to their account.",
      rebooking: "Wants a replacement item or appointment.",
      info: "Asking for information only — no action needed.",
    }),
    severity: score("How urgent is ticket on a 0 (low) to 5 (critical) scale?", 0, 5),
    is_angry: noul("Does ticket express anger or strong frustration?"),
  },
});

// Fully typed — no casts needed:
const { choice: label, probabilities, confidence } = answers.category;
const level: number = answers.severity.score;
const angry: number = answers.is_angry.noul;

if (is_angry.noul > 0.7) softenTone();
if (severity.score >= 4) page();
route(label);             // "refund" | "rebooking" | "info"`,
        },
      },
      {
        heading: "Overriding the model per call",
        body: "Each call can override the client's default model. Useful when you want laya-mlx on a Mac dev box but laya-onnx in production Linux containers — set the default in the environment and only override in tests.",
        code: {
          lang: "ts",
          code: `const { answers } = await client.systemOne({
  model: "laya-mlx",   // overrides client default for this call only
  state: { review },
  questions: {
    sentiment: score("Sentiment of review (1 negative … 5 positive)?", 1, 5),
    is_spam:   noul("Is review spam or synthetic?"),
  },
});`,
        },
      },
      {
        heading: "Error handling",
        body: "client.systemOne() throws TypeSafeError for 4xx/5xx responses and native Error for network failures. TypeSafeError exposes status (HTTP code) and message (server body). Wrap the call in try/catch and branch on status for production handlers.",
        code: {
          lang: "ts",
          code: `import { TypeSafeClient, TypeSafeError, choice } from "@caelum/typesafe";

try {
  const { answers } = await client.systemOne({ state, questions });
  return answers.intent.choice;
} catch (err) {
  if (err instanceof TypeSafeError) {
    if (err.status === 429) await backoff(err.retryAfterMs ?? 1000);
    else if (err.status >= 500) logger.error("engine error", err.message);
    else throw err; // 4xx client errors are programming errors
  } else {
    logger.error("network error", err);
    throw err;
  }
}`,
        },
      },
    ],
    table: {
      caption: "Answer shape by primitive",
      colA: "Field",
      colB: "Type",
      rows: [
        { label: "choice()", a: "choice: string key from your options map", b: "probabilities: Record<string,number>; confidence: number" },
        { label: "score()", a: "score: integer between min and max", b: "probabilities: Record<number,number>; confidence: number" },
        { label: "noul()", a: "noul: number in [0,1] — P(yes)", b: "confidence: number (same as noul)" },
      ],
    },
    faqs: [
      {
        q: "Does the SDK work in browser / edge environments?",
        a: "The client uses the native fetch API and has no Node-only dependencies, so it works in modern browsers, Cloudflare Workers, Vercel Edge, and Deno Deploy as well as Node 18+. You will need to supply baseURL explicitly since process.env is not available in browser contexts.",
      },
      {
        q: "How do I self-host and point the SDK at my own engine?",
        a: "Set OPENJEV_BASE_URL to your engine's origin (e.g. http://localhost:3000) before starting the process, or pass baseURL: 'http://localhost:3000' to the constructor. The request shape is identical to the hosted endpoint.",
      },
      {
        q: "Can I reuse one client across workers or serverless invocations?",
        a: "Yes. TypeSafeClient is stateless between calls — it holds only configuration, not session state — so sharing one instance across concurrent calls or across serverless warm invocations is safe.",
      },
      {
        q: "What Node version is required?",
        a: "Node 18 or later (native fetch). The package targets ES2022 and ships ESM + CJS dual builds so it works in both module systems.",
      },
    ],
    related: [
      { kind: "sdk", slug: "python", label: "Python SDK" },
      { kind: "sdk", slug: "rest-api", label: "Raw HTTP / REST API" },
      { kind: "guide", slug: "typed-llm-decisions", label: "What a typed decision is" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
    ],
    updated: UPDATED,
  },
  {
    slug: "python",
    title: "openjev — the official Python client",
    navLabel: "Python",
    kind: "official",
    category: "Official SDK",
    description:
      "Install OpenJev, initialise TypeSafeClient, and call system_one() with Choice, Score, and Noul questions from Python services or notebooks.",
    keywords: [
      "openjev python sdk",
      "typesafe python client",
      "llm decision python",
      "systemone python",
      "typed llm python",
    ],
    intro:
      "openjev is the official Python client for openjev. It exposes a TypeSafeClient with a synchronous system_one() method and an async async_system_one() equivalent, three question-builder functions — choice(), score(), noul() — and dataclass answer types that carry the value, probabilities, and confidence for each primitive.",
    takeaways: [
      "Installing sdk/python from the repo gives you TypeSafeClient, choice(), score(), and noul().",
      "system_one() is synchronous; async_system_one() is for asyncio services and notebooks.",
      "The client reads OPENJEV_BASE_URL and OPENJEV_API_KEY from the environment.",
      "TypeSafeError carries status_code and message for structured error handling.",
    ],
    sections: [
      {
        heading: "Installation",
        body: "Not on PyPI yet: install from a clone of the repository. Python 3.10 or later is required. The package has no heavy dependencies — it uses httpx for sync/async HTTP and dataclasses for return types.",
        code: {
          lang: "bash",
          code: `git clone https://github.com/caelum0x/openjev.git
pip install ./openjev/sdk/python`,
        },
      },
      {
        heading: "Initialising the client",
        body: "Create a TypeSafeClient once and reuse it across calls. base_url and api_key default to environment variables OPENJEV_BASE_URL and OPENJEV_API_KEY respectively. Pass model to set the default for every call.",
        code: {
          lang: "python",
          code: `from openjev import TypeSafeClient

# Reads base_url and api_key from the environment.
client = TypeSafeClient()

# Or supply them explicitly:
client = TypeSafeClient(
    base_url="http://localhost:3000",
    api_key=os.environ["TYPESAFE_KEY"],
    model="laya-onnx",
    timeout=10.0,
)`,
        },
      },
      {
        heading: "Making a decision: system_one()",
        body: "Call system_one() with a state dict and a questions dict whose values are built with choice(), score(), or noul(). The return value is a SystemOneResponse with an answers attribute — a dict from question name to a typed answer dataclass.",
        code: {
          lang: "python",
          code: `from openjev import TypeSafeClient, choice, score, noul

client = TypeSafeClient()

response = client.system_one(
    state={"ticket": "Order #4820 was charged twice this week."},
    questions={
        "category": choice(
            "What does the sender of ticket want?",
            options={
                "refund":    "Wants money returned to their account.",
                "rebooking": "Wants a replacement item.",
                "info":      "Asking for information only.",
            },
        ),
        "severity": score(
            "How urgent is ticket on a 0 (low) to 5 (critical) scale?",
            min=0,
            max=5,
        ),
        "is_angry": noul("Does ticket express anger or strong frustration?"),
    },
)

cat   = response.answers["category"]   # ChoiceAnswer
sev   = response.answers["severity"]   # ScoreAnswer
angry = response.answers["is_angry"]   # NoulAnswer

print(cat.choice, cat.confidence)          # e.g. "refund" 0.87
print(sev.score, sev.probabilities)        # e.g. 4 {0: 0.01, 1: 0.02, ...}
print(angry.noul)                          # e.g. 0.82`,
        },
      },
      {
        heading: "Async usage with asyncio",
        body: "For FastAPI or asyncio services, use async_system_one(). The signature is identical to system_one() — only the calling convention changes. The underlying HTTP transport is the same httpx session.",
        code: {
          lang: "python",
          code: `import asyncio
from openjev import TypeSafeClient, choice, noul

client = TypeSafeClient()

async def classify(text: str) -> str:
    resp = await client.async_system_one(
        state={"text": text},
        questions={
            "intent": choice(
                "What does text want?",
                options={"sales": "Buying interest.", "support": "Has a problem.", "other": "Unrelated."},
            ),
            "is_spam": noul("Is text spam?"),
        },
    )
    if resp.answers["is_spam"].noul > 0.6:
        return "spam"
    return resp.answers["intent"].choice

# asyncio.run(classify("I want to cancel my subscription"))`,
        },
      },
      {
        heading: "Error handling",
        body: "TypeSafeError is raised for 4xx/5xx responses and includes status_code plus message. Standard Python network exceptions are raised for connection-level failures. Check status_code to distinguish a caller error (400) from an engine error (500) or rate limit (429).",
        code: {
          lang: "python",
          code: `from openjev import TypeSafeClient, TypeSafeError, choice

client = TypeSafeClient()

try:
    resp = client.system_one(state=state, questions=questions)
    return resp.answers["category"].choice
except TypeSafeError as e:
    if e.status_code == 429:
        time.sleep(e.retry_after_seconds or 1)
        # retry...
    elif e.status_code >= 500:
        logger.error("engine error: %s", e.message)
        raise
    else:
        raise  # 4xx: likely a programming error
except Exception as e:
    logger.error("network error: %s", e)
    raise`,
        },
      },
    ],
    faqs: [
      {
        q: "Does the Python SDK work in Jupyter notebooks?",
        a: "Yes. Use the synchronous system_one() directly in a notebook cell, or use async_system_one() in an async cell (Jupyter supports top-level await). The client has no process-level side effects.",
      },
      {
        q: "Is there a way to batch many rows efficiently?",
        a: "Submit rows concurrently with asyncio.gather() and async_system_one(). Each call is an independent HTTP request; the engine processes them in parallel. For very large backfills, use a self-hosted engine to avoid rate limits.",
      },
      {
        q: "What Python versions are supported?",
        a: "Python 3.10 and later. The package uses match statements and structural pattern matching only internally; user-facing code works on 3.10+ without special syntax.",
      },
    ],
    related: [
      { kind: "sdk", slug: "python-adapter", label: "Python adapter (no server)" },
      { kind: "sdk", slug: "javascript", label: "JavaScript / TypeScript SDK" },
      { kind: "sdk", slug: "rest-api", label: "Raw HTTP / REST API" },
      { kind: "guide", slug: "for-data-teams", label: "openjev for data teams" },
    ],
    updated: UPDATED,
  },
  {
    slug: "python-adapter",
    title: "openjev — client-side LLM-backed decisions, no server",
    navLabel: "Python adapter",
    kind: "official",
    category: "Adapter SDK",
    description:
      "Use OpenJev to get typed decisions entirely client-side, backed by any LLM you configure — no openjev server or Docker image required.",
    keywords: [
      "openjev adapter python",
      "llm decision no server",
      "client side llm classification",
      "typesafe adapter openai",
      "local llm decision python",
    ],
    intro:
      "openjev is a drop-in Python client that runs the entire typed-decision logic client-side, calling an LLM of your choice directly. No openjev server, no Docker image, and no self-hosting is required. The adapter speaks the same Python API as OpenJev, so swapping between the two is a one-line change.",
    takeaways: [
      "The adapter runs entirely in-process — no openjev server, daemon, or Docker image needed.",
      "It calls any LLM you configure (OpenAI, Anthropic, a local Ollama endpoint, …) to fill typed decisions.",
      "The Python API — TypeSafeClient, system_one(), choice(), score(), noul() — is identical to the server-backed SDK.",
      "Use the server-backed SDK for production volume; use the adapter for prototyping, CI, or environments where running a server is impractical.",
    ],
    sections: [
      {
        heading: "What the adapter does",
        body: "The adapter implements the same TypeSafeClient interface but instead of sending a request to an OpenJev engine, it constructs a typed-decision prompt internally and calls the LLM backend you supply. The prompt enforces the closed answer set and extracts the probability distribution from the model's response. From your code's perspective, it is identical to the server-backed client.",
        bullets: [
          "No server, daemon, or model download needed — LLM calls go straight to the provider you configure.",
          "Swap adapter for server by changing one import line — both are TypeSafeClient.",
          "Useful for prototyping, testing in CI, or environments where Docker is unavailable.",
          "Confidence values come from the adapter's prompt-engineering; server-backed engines produce better-calibrated scores at volume.",
        ],
      },
      {
        heading: "Installation",
        body: "Install the adapter package and at least one provider extra. Provider extras install the required client library for the LLM backend you want to use.",
        code: {
          lang: "bash",
          code: `pip install ./openjev/adapters/python

# Include the provider extras you need:
pip install "./openjev/adapters/python[openai]"    # OpenAI / Azure OpenAI
pip install "./openjev/adapters/python[anthropic]" # Anthropic Claude
pip install "./openjev/adapters/python[ollama]"   # local Ollama`,
        },
      },
      {
        heading: "Configuring the adapter with an LLM backend",
        body: "Import from openjev_adapters instead of openjev. Pass the adapter to TypeSafeClient via the adapter= parameter. The rest of your code — state, questions, answer reading — is unchanged.",
        code: {
          lang: "python",
          code: `from openjev_adapters import TypeSafeClient, OpenAIAdapter, choice, score, noul
import os

# OpenAI backend:
client = TypeSafeClient(
    adapter=OpenAIAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4o-mini",
    )
)

# Anthropic backend:
from openjev_adapters import AnthropicAdapter
client = TypeSafeClient(
    adapter=AnthropicAdapter(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        model="claude-haiku-4-5",
    )
)

# Local Ollama backend (no API key needed):
from openjev_adapters import OllamaAdapter
client = TypeSafeClient(adapter=OllamaAdapter(model="llama3.2"))`,
        },
      },
      {
        heading: "Full Choice + Score + Noul example",
        body: "Once the client is configured, call system_one() exactly as you would with the server-backed SDK. The adapter transparently wraps the LLM call, enforces the closed answer set, and returns the same answer dataclasses.",
        code: {
          lang: "python",
          code: `response = client.system_one(
    state={"email": "Hi, I need to cancel my subscription immediately."},
    questions={
        "intent": choice(
            "What does the sender of email want?",
            options={
                "cancel":  "Wants to end or cancel a subscription.",
                "pause":   "Wants a temporary hold.",
                "upgrade": "Interested in a higher tier.",
                "other":   "Something else.",
            },
        ),
        "urgency": score("How urgent is email on a 1 (low) to 3 (high) scale?", min=1, max=3),
        "at_risk":  noul("Is email from a customer at risk of churning?"),
    },
)

print(response.answers["intent"].choice)   # "cancel"
print(response.answers["urgency"].score)   # 3
print(response.answers["at_risk"].noul)    # e.g. 0.91`,
        },
      },
      {
        heading: "Adapter vs server-backed SDK: when to use which",
        body: "The adapter is ideal for prototyping new features, running in CI without infrastructure, and environments where deploying a Docker image is impractical. The server-backed SDK with a local engine is better for production: the engine's calibration is tighter, latency is lower (no LLM call on the hot path), and cost is near-zero at volume. Design your code against the shared TypeSafeClient interface so the swap is a one-line import change.",
      },
    ],
    table: {
      caption: "Adapter vs server-backed SDK",
      colA: "openjev",
      colB: "openjev + engine",
      rows: [
        { label: "Server required", a: "No — runs entirely in-process", b: "Yes — OpenJev engine (Docker or hosted)" },
        { label: "LLM backend", a: "Any you configure: OpenAI, Anthropic, Ollama …", b: "laya-mlx, laya-onnx, native scorer, or any-LLM" },
        { label: "Confidence calibration", a: "Prompt-engineering based; good for prototypes", b: "Engine-calibrated; reliable for production thresholds" },
        { label: "Latency", a: "One LLM call per request", b: "Milliseconds on a local engine (no generation)" },
        { label: "Production cost", a: "Pays per LLM token", b: "Near-zero output tokens on a local backend" },
        { label: "API surface", a: "Identical: TypeSafeClient / system_one() / choice() / score() / noul()", b: "Identical" },
      ],
    },
    faqs: [
      {
        q: "Can I switch from the adapter to the server-backed SDK without changing my decision code?",
        a: "Yes. Both packages expose the same TypeSafeClient class, system_one() method, and question builders. Change the import from openjev_adapters to OpenJev and supply a base_url instead of an adapter — no decision logic changes.",
      },
      {
        q: "Is the adapter suitable for production traffic?",
        a: "For low-volume or internal use it works well. For high-volume production traffic, the server-backed SDK with a local engine is recommended: the engine does not call an LLM for each decision, so latency is milliseconds and cost is near-zero.",
      },
      {
        q: "Which LLM models work best with the adapter?",
        a: "Any instruction-following model works. Larger models (gpt-4o, claude-sonnet-4-6) give more reliable closed-set adherence. Smaller models (gpt-4o-mini, claude-haiku-4-5, llama3.2) are faster and cheaper for prototyping when the answer set is unambiguous.",
      },
    ],
    related: [
      { kind: "sdk", slug: "python", label: "Python server-backed SDK" },
      { kind: "sdk", slug: "javascript", label: "JavaScript / TypeScript SDK" },
      { kind: "guide", slug: "closed-set-choice-vs-free-text", label: "Closed-set vs free text" },
      { kind: "guide", slug: "for-backends", label: "openjev for backends" },
    ],
    updated: UPDATED,
  },
  // ── HTTP ──────────────────────────────────────────────────────────────────
  {
    slug: "rest-api",
    title: "openjev REST API — raw HTTP POST /v1/systemone",
    navLabel: "REST API",
    kind: "http",
    category: "HTTP / REST",
    description:
      "Call POST /v1/systemone directly from any language or tool: full request and response shapes, authentication, curl examples, and a Python requests walkthrough.",
    keywords: [
      "openjev rest api",
      "systemone http api",
      "post v1 systemone",
      "typed decision api curl",
      "llm decision http",
    ],
    intro:
      "Every OpenJev SDK is a thin layer over a single HTTP endpoint: POST /v1/systemone. You can call it from any language, tool, or environment that can send a JSON POST. This guide covers the full request and response shape, authentication, all three question types, and runnable examples in curl and Python requests.",
    takeaways: [
      "One endpoint — POST /v1/systemone — handles all three primitives in a single call.",
      "The request body is {model?, state, questions}; each question is {type, instructions, options?}.",
      "The response body is {answers}; each answer carries type, the typed value, probabilities, and confidence.",
      "The same payload runs against any openjev-compatible endpoint (hosted or self-hosted).",
    ],
    sections: [
      {
        heading: "Endpoint and authentication",
        body: "The endpoint is POST /v1/systemone relative to your base URL. The hosted service uses Bearer token authentication; a self-hosted engine can be configured to require a key or left open on a private network. Send the API key in an Authorization header.",
        code: {
          lang: "bash",
          code: `# Hosted:
BASE=http://localhost:3000

# Self-hosted (Docker):
BASE=http://localhost:3000

# Authentication header (omit if self-hosted without auth):
Authorization: Bearer $TYPESAFE_API_KEY`,
        },
      },
      {
        heading: "Request shape",
        body: "The JSON body has three top-level fields: model (optional, defaults to the engine's configured backend), state (any JSON object describing the context), and questions (an object whose keys are your answer names and whose values describe the question type and parameters).",
        code: {
          lang: "json",
          code: `{
  "model": "laya-onnx",
  "state": {
    "ticket": "Order #4820 was charged twice and I am furious."
  },
  "questions": {
    "category": {
      "type": "choice",
      "instructions": "What does the sender of ticket want?",
      "options": {
        "refund":    "Wants money returned to their account.",
        "rebooking": "Wants a replacement item or appointment.",
        "info":      "Asking for information only, no action needed."
      }
    },
    "severity": {
      "type": "score",
      "instructions": "How urgent is ticket on a 0 (low) to 5 (critical) scale?",
      "options": { "min": 0, "max": 5 }
    },
    "is_angry": {
      "type": "noul",
      "instructions": "Does ticket express anger or strong frustration?"
    }
  }
}`,
        },
      },
      {
        heading: "Sending the request with curl",
        body: "Save the request body to a file and POST it with curl. The response is JSON you can pipe to jq for inspection.",
        code: {
          lang: "bash",
          code: `curl -s -X POST "$BASE/v1/systemone" \\
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "state": { "ticket": "Charged twice — please refund immediately." },
    "questions": {
      "category": {
        "type": "choice",
        "instructions": "What does the sender of ticket want?",
        "options": { "refund": "Wants money back.", "info": "Wants information." }
      },
      "is_angry": {
        "type": "noul",
        "instructions": "Does ticket express anger?"
      }
    }
  }' | jq .`,
        },
      },
      {
        heading: "Response shape",
        body: "The response body is {answers}, a map from question name to an answer object. Each answer carries type (matching the question type), the primitive value, a probabilities map, and a confidence number.",
        code: {
          lang: "json",
          code: `{
  "answers": {
    "category": {
      "type": "choice",
      "choice": "refund",
      "probabilities": { "refund": 0.88, "info": 0.12 },
      "confidence": 0.88
    },
    "severity": {
      "type": "score",
      "score": 4,
      "probabilities": { "0": 0.01, "1": 0.02, "2": 0.05, "3": 0.12, "4": 0.68, "5": 0.12 },
      "confidence": 0.68
    },
    "is_angry": {
      "type": "noul",
      "noul": 0.84,
      "confidence": 0.84
    }
  }
}`,
        },
      },
      {
        heading: "Calling the API from Python with requests",
        body: "If you prefer not to install the SDK, the API is straightforward to call with the standard requests library. This pattern is useful for quick scripts or languages with no official SDK.",
        code: {
          lang: "python",
          code: `import os, requests

BASE = os.environ.get("OPENJEV_BASE_URL", "http://localhost:3000")
KEY  = os.environ.get("OPENJEV_API_KEY", "")

def decide(state: dict, questions: dict) -> dict:
    resp = requests.post(
        f"{BASE}/v1/systemone",
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        json={"state": state, "questions": questions},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["answers"]

answers = decide(
    state={"review": "Great product but shipping took 3 weeks."},
    questions={
        "sentiment": {
            "type": "score",
            "instructions": "Sentiment of review: 1 = very negative, 5 = very positive.",
            "options": {"min": 1, "max": 5},
        },
        "mentions_shipping": {
            "type": "noul",
            "instructions": "Does review mention shipping or delivery?",
        },
    },
)
print(answers["sentiment"]["score"])          # e.g. 3
print(answers["mentions_shipping"]["noul"])   # e.g. 0.97`,
        },
      },
    ],
    faqs: [
      {
        q: "Do I need an SDK to use OpenJev?",
        a: "No. Every OpenJev SDK is a convenience wrapper over POST /v1/systemone. You can call it with curl, fetch, requests, or any HTTP client in any language. The SDKs add typed question builders, typed response classes, and error handling.",
      },
      {
        q: "What content-type should I send?",
        a: "application/json. The request body must be a JSON object with a state field and a questions field. The model field is optional.",
      },
      {
        q: "What HTTP status codes does the API return?",
        a: "200 on success. 400 if the request body is invalid (bad question type, missing required field). 401 if the API key is missing or invalid. 422 if state or questions fail validation. 429 for rate limiting (check the Retry-After header). 5xx for engine errors.",
      },
      {
        q: "Is the API versioned?",
        a: "Yes — the path is /v1/systemone. The v1 prefix will remain stable; breaking changes, if any, will be introduced under a new version prefix with a deprecation window.",
      },
    ],
    related: [
      { kind: "sdk", slug: "javascript", label: "JavaScript SDK" },
      { kind: "sdk", slug: "python", label: "Python SDK" },
      { kind: "sdk", slug: "cli", label: "CLI tools" },
      { kind: "doc", slug: "api-reference", label: "Full API reference" },
    ],
    updated: UPDATED,
  },
  // ── CLI ───────────────────────────────────────────────────────────────────
  {
    slug: "cli",
    title: "openjev CLI — serve, laya-download, and decide",
    navLabel: "CLI",
    kind: "cli",
    category: "CLI",
    description:
      "Use the OpenJev CLI to start a local engine, download laya models, run one-shot decisions from the terminal, and script decision pipelines without writing application code.",
    keywords: [
      "openjev cli",
      "laya download cli",
      "typesafe serve command",
      "local llm decision cli",
      "openjev terminal",
    ],
    intro:
      "The OpenJev CLI is a single Node.js script — scripts/cli.mjs — that ships with every engine release. It has four main commands: serve (start a local engine), laya-download (fetch a laya model), decide (run a one-shot typed decision from the terminal), and inspect (pretty-print a saved decision file). No SDK installation required for the CLI itself.",
    takeaways: [
      "cli.mjs serve starts the engine on localhost:3000 (or any port you choose) in seconds.",
      "cli.mjs laya-download fetches the laya-onnx or laya-mlx model bundle for your platform.",
      "cli.mjs decide lets you run a typed decision interactively or piped from a JSON file — useful for debugging and scripts.",
      "All commands respect OPENJEV_BASE_URL, OPENJEV_MODEL, and OPENJEV_API_KEY.",
    ],
    sections: [
      {
        heading: "Installing and running the CLI",
        body: "The CLI ships with the OpenJev npm package. Install it globally or run it with npx. You do not need the CLI installed to use the SDK; the CLI is a convenience tool for local development and scripting.",
        code: {
          lang: "bash",
          code: `# Install the engine package globally:
npm install -g openjev

# Verify:
openjev --version

# Or run without installing via npx:
npx openjev --version

# The CLI is also available as scripts/cli.mjs inside the package:
node $(npm root -g)/openjev/scripts/cli.mjs --help`,
        },
      },
      {
        heading: "serve — start a local engine",
        body: "cli.mjs serve starts the OpenJev HTTP engine on the specified port. The engine loads the backend you select at startup (laya-onnx is the default on Linux; laya-mlx is used automatically on Apple silicon). Once running, point any SDK at http://localhost:<port>.",
        code: {
          lang: "bash",
          code: `# Start on default port 3000 with laya-onnx:
openjev serve

# Custom port and backend:
openjev serve --port 4000 --backend laya-mlx

# Require an API key (bearer token):
openjev serve --require-key $MY_LOCAL_KEY

# Set via environment instead of flags:
OPENJEV_PORT=4000 OPENJEV_BACKEND=laya-onnx openjev serve`,
        },
      },
      {
        heading: "laya-download — fetch a model bundle",
        body: "Before using laya-onnx or laya-mlx as the backend, download the model bundle for your platform. laya-download detects your OS and architecture automatically and places the model in the default cache directory (~/.openjev/models). Use --dest to override.",
        code: {
          lang: "bash",
          code: `# Download the laya-onnx bundle (default, works on Linux/macOS/Windows CPU):
openjev laya-download

# Download laya-mlx (Apple silicon only):
openjev laya-download --backend laya-mlx

# Download to a custom directory:
openjev laya-download --dest /opt/models/laya

# Check what is already downloaded:
openjev laya-download --list`,
        },
      },
      {
        heading: "decide — one-shot decision from the terminal",
        body: "cli.mjs decide sends a typed decision request to the running engine (or a hosted endpoint) and prints the answers as JSON. Pass state and questions inline as JSON flags, or pipe a request file from stdin. Useful for debugging, spot-checks, and shell scripts.",
        code: {
          lang: "bash",
          code: `# Pipe a saved request file to the engine and print the answers:
cat request.json | openjev decide

# Inline state and a single choice question:
openjev decide \\
  --state '{"ticket":"Charged twice, need a refund"}' \\
  --question 'category:choice:What does ticket want?:refund=Wants money back.,info=Wants information.'

# Pretty-print the full answer including probabilities:
openjev decide --file request.json --pretty

# Target a different base URL:
OPENJEV_BASE_URL=http://localhost:4000 openjev decide --file request.json`,
        },
      },
      {
        heading: "Scripting decisions in shell",
        body: "Because decide outputs newline-delimited JSON, you can pipe it through jq to extract fields and drive shell logic. This is useful for CI checks, pre-deploy policy gates, and data scripts that do not need a full application.",
        code: {
          lang: "bash",
          code: `#!/usr/bin/env bash
# Classify a batch of files and print the category + confidence for each.
set -euo pipefail

for f in inputs/*.txt; do
  TEXT=$(cat "$f")
  RESULT=$(openjev decide \\
    --state "{\\"doc\\":$(printf '%s' "$TEXT" | jq -Rs .)}" \\
    --question 'topic:choice:Topic of doc?:legal=Legal content.,financial=Financial content.,other=Other.' \\
    2>/dev/null)
  CHOICE=$(echo "$RESULT" | jq -r '.answers.topic.choice')
  CONF=$(echo "$RESULT"   | jq -r '.answers.topic.confidence')
  echo "$f  $CHOICE  $CONF"
done`,
        },
      },
    ],
    faqs: [
      {
        q: "Does the CLI install the engine, or is it just a thin wrapper?",
        a: "The CLI ships inside the OpenJev npm package, which also includes the engine binary. Installing the package globally gives you both the CLI and the engine. The model bundle (laya) is downloaded separately with laya-download.",
      },
      {
        q: "What is the difference between laya-onnx and laya-mlx?",
        a: "laya-onnx runs on CPU via ONNX Runtime and is the default on Linux and Windows — it works everywhere, just without GPU acceleration. laya-mlx uses Apple's MLX framework for GPU acceleration on Apple silicon and is automatically selected on M-series Macs when available.",
      },
      {
        q: "Can I use the CLI to test a remote hosted endpoint?",
        a: "Yes. Set OPENJEV_BASE_URL to the hosted endpoint and OPENJEV_API_KEY to your key, then run decide normally. The CLI targets whatever base URL is configured, local or remote.",
      },
      {
        q: "Is the serve command production-ready?",
        a: "For local development and internal tools, yes. For public production traffic, wrap it with a reverse proxy (nginx, Caddy) that handles TLS, rate limiting, and connection pooling. The engine itself has no TLS support built in.",
      },
    ],
    related: [
      { kind: "sdk", slug: "rest-api", label: "REST API reference" },
      { kind: "sdk", slug: "javascript", label: "JavaScript SDK" },
      { kind: "guide", slug: "for-backends", label: "openjev for backends" },
      { kind: "doc", slug: "self-hosting", label: "Self-hosting guide" },
    ],
    updated: UPDATED,
  },
];

export function sdkBySlug(slug: string): SdkGuide | undefined {
  return SDKS.find((s) => s.slug === slug);
}

export const SDK_SLUGS: readonly string[] = SDKS.map((s) => s.slug);

const SDK_GROUP_DEFS: ReadonlyArray<{ kind: SdkKind; label: string }> = [
  { kind: "official", label: "Official SDKs" },
  { kind: "http", label: "HTTP & REST" },
  { kind: "cli", label: "CLI Tools" },
];

export const SDK_GROUPS: ReadonlyArray<{
  kind: SdkKind;
  label: string;
  sdks: readonly SdkGuide[];
}> = SDK_GROUP_DEFS.map((g) => ({
  ...g,
  sdks: SDKS.filter((x) => x.kind === g.kind),
}));
