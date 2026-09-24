/**
 * INTEGRATIONS — the content behind /integrations and /integrations/$slug.
 *
 * Ten real integration guides showing how to wire a typed OpenJev decision
 * into a specific framework or runtime: install, client init, a full working
 * example, and gotchas. Every guide uses the real API shape:
 *
 *   POST /api/v1/systemone
 *   { state, questions: { name: choice(…) | score(…) | noul(…) } }
 *   → { answers: { name: { type, choice/score/noul, confidence, probabilities } } }
 *
 * Stacks covered: nextjs, node-express, fastapi, django, langchain-js,
 * langchain-python, vercel-ai-sdk, cloudflare-workers, deno-deploy,
 * supabase-edge-functions.
 */

import { MEASURED_LATENCY as ML } from "@/lib/content/benchmarks";
import { PACKAGE_INTEGRATIONS } from "./integrations-packages";

export type IntegrationKind = "js-ts" | "python" | "edge";

export interface IntegrationSection {
  readonly heading: string;
  /** Optional prose body — omit for install / gotchas sections that are code-only or bullet-only. */
  readonly body?: string;
  readonly bullets?: readonly string[];
  readonly code?: { readonly lang?: string; readonly code: string };
}

export interface IntegrationFAQ {
  readonly q: string;
  readonly a: string;
}

export interface IntegrationRelated {
  readonly kind: "guide" | "doc" | "use-case" | "compare";
  readonly slug: string;
  readonly label: string;
}

export interface Integration {
  readonly slug: string;
  readonly title: string;
  readonly navLabel: string;
  readonly kind: IntegrationKind;
  readonly category: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly intro: string;
  readonly takeaways: readonly string[];
  readonly sections: readonly IntegrationSection[];
  readonly faqs: readonly IntegrationFAQ[];
  readonly related: readonly IntegrationRelated[];
  readonly updated: string;
}

const UPDATED = "2026-09-23";

export const INTEGRATIONS: readonly Integration[] = [
  // ── JavaScript / TypeScript ───────────────────────────────────────────────
  {
    slug: "nextjs",
    title: "openjev with Next.js: typed decisions in App Router handlers",
    navLabel: "Next.js",
    kind: "js-ts",
    category: "Next.js",
    description:
      "Wire typed OpenJev decisions into Next.js App Router route handlers and Server Actions — classify tickets, gate content, and route requests without text parsing.",
    keywords: [
      "nextjs typed decision",
      "nextjs llm classification",
      "app router ai",
      "openjev nextjs",
      "next route handler llm",
    ],
    intro:
      "In a Next.js App Router codebase, the temptation is to call a generative LLM and parse its reply whenever you need a classification or gate. That pattern breaks at the first prompt change. A typed decision is the cleaner primitive: you declare the answer space in the route handler, get a typed value back, and branch on it — nothing to parse, no retry loop.",
    takeaways: [
      "Instantiate TypeSafeClient once at module scope in your route handler — it is a singleton, not created per request.",
      "Use OPENJEV_BASE_URL and OPENJEV_API_KEY in .env.local; never expose them to the client bundle.",
      "Server Actions and route handlers both work — the call is async/await over HTTPS.",
      "The decision is deterministic, so you can write stable integration tests against a local engine in CI.",
    ],
    sections: [
      {
        heading: "Why typed decisions fit App Router",
        body: "App Router server code runs close to the request and benefits from short, predictable latency. A generative call is the worst shape here: tokens, network round trips, and fragile parsing. A typed decision skips generation entirely — the engine scores a closed answer set and returns the winner. On a self-hosted engine the round trip is a local hop; on a hosted endpoint it is a single HTTPS call with no streaming.",
      },
      {
        heading: "Install and configure",
        code: {
          lang: "bash",
          code: `# Install the TypeScript client
npm install @caelum/typesafe

# .env.local (never commit real keys)
OPENJEV_BASE_URL=http://localhost:3000
OPENJEV_API_KEY=your-api-key`,
        },
      },
      {
        heading: "Full working example: support ticket router",
        body: "A route handler that classifies an inbound support ticket, scores its urgency, and decides whether it needs a human — one POST, three typed answers.",
        code: {
          lang: "ts",
          code: `// app/api/tickets/route.ts
import { NextResponse } from "next/server";
import { TypeSafeClient, choice, score, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({
  baseUrl: process.env.OPENJEV_BASE_URL ?? "http://localhost:3000",
  apiKey: process.env.OPENJEV_API_KEY,
});

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text: string };

  const { answers } = await client.systemOne({
    state: { ticket: text },
    questions: {
      category: choice("Main request in \`ticket\`?", {
        refund: "Customer wants money returned.",
        rebooking: "Customer needs a schedule change.",
        info: "Customer is asking for information only.",
      }),
      severity: score("Urgency of \`ticket\`? (1 low … 5 critical)", 1, 5),
      needs_human: noul("Does \`ticket\` require a human agent?"),
    },
  });

  // Gate: escalate uncertain or human-required tickets
  if (
    answers.needs_human.noul > 0.7 ||
    answers.category.confidence < 0.6
  ) {
    return NextResponse.json({ escalate: true, probabilities: answers.category.probabilities });
  }

  return NextResponse.json({
    queue: answers.category.choice,
    priority: answers.severity.score,
    confidence: answers.category.confidence,
  });
}`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "Server Actions run in the same Node.js environment as route handlers — the same client singleton works in both.",
          "Edge Runtime does not support Node.js APIs; use the raw fetch approach (same JSON body, no SDK) if you deploy to the Edge.",
          "Never import OPENJEV_API_KEY in a Client Component — it will be included in the browser bundle.",
          "For local development, docker run openjev/engine and set OPENJEV_BASE_URL=http://localhost:3000.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I use this in a Server Action instead of a route handler?",
        a: "Yes. Server Actions run server-side with full Node.js access. Instantiate the client at module scope and call systemOne from the action body — the same pattern as a route handler.",
      },
      {
        q: "How do I test this in CI without a live API?",
        a: "Run docker run openjev/engine in your CI job and set OPENJEV_BASE_URL=http://localhost:3000. Decisions are deterministic, so the same test input always returns the same answer.",
      },
      {
        q: "Does this work with the Pages Router too?",
        a: "Yes. The API call is standard async/await — use it in a pages/api route handler exactly as shown. The client is framework-agnostic.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-backends", label: "openjev for backend engineers" },
      { kind: "guide", slug: "typed-llm-decisions", label: "What a typed decision is" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
      { kind: "doc", slug: "self-hosting", label: "Self-hosting the engine" },
    ],
    updated: UPDATED,
  },
  {
    slug: "node-express",
    title: "openjev with Express: typed decision middleware for Node.js APIs",
    navLabel: "Node + Express",
    kind: "js-ts",
    category: "Node.js",
    description:
      "Add typed OpenJev decisions to an Express.js API as a middleware layer — classify inbound requests, gate routes by intent, and enrich payloads before they reach your handlers.",
    keywords: [
      "express llm middleware",
      "node typed decision",
      "openjev express",
      "classify request express",
      "node llm classification",
    ],
    intro:
      "Express middleware is the natural place to classify inbound payloads: parse the body, decide its intent or safety, annotate the request, and pass control to the handler. OpenJev fits this slot directly — one systemOne call per request, typed answers attached to req.body, no text-parsing glue required.",
    takeaways: [
      "Build a reusable classifyMiddleware that calls systemOne and annotates req with typed answers.",
      "Gate dangerous or off-topic requests before they reach your business logic.",
      "Use a module-scope client singleton so the HTTP connection pool is shared across requests.",
      "Deterministic decisions make middleware behaviour testable with supertest and stable golden fixtures.",
    ],
    sections: [
      {
        heading: "Install",
        code: {
          lang: "bash",
          code: `npm install @caelum/typesafe express
# Types (if using TypeScript):
npm install --save-dev @types/express`,
        },
      },
      {
        heading: "Typed decision middleware",
        body: "A single middleware that classifies the message body, blocks spam, and attaches the typed intent to req so downstream handlers branch on a value, not a parsed string.",
        code: {
          lang: "ts",
          code: `// src/middleware/classify.ts
import type { Request, Response, NextFunction } from "express";
import { TypeSafeClient, choice, noul } from "@caelum/typesafe";

// Singleton: one client, one connection pool for all requests.
const client = new TypeSafeClient({
  baseUrl: process.env.OPENJEV_BASE_URL!,
  apiKey: process.env.OPENJEV_API_KEY,
});

export async function classifyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const message = (req.body as { message?: string }).message;
  if (!message) return next();

  const { answers } = await client.systemOne({
    state: { message },
    questions: {
      spam: noul("Is \`message\` spam or unsolicited commercial content?"),
      intent: choice("Intent of \`message\`?", {
        support: "Needs help with an existing account or product.",
        sales:   "Interested in purchasing or upgrading.",
        other:   "Something else.",
      }),
    },
  });

  if (answers.spam.noul > 0.8) {
    res.status(400).json({ error: "Message rejected." });
    return;
  }

  // Annotate the request for downstream handlers.
  (req as Request & { intent: string; intentConfidence: number }).intent = answers.intent.choice;
  (req as Request & { intent: string; intentConfidence: number }).intentConfidence = answers.intent.confidence;
  next();
}`,
        },
      },
      {
        heading: "Wire it into your router",
        code: {
          lang: "ts",
          code: `// src/app.ts
import express from "express";
import { classifyMiddleware } from "./middleware/classify";

const app = express();
app.use(express.json());

app.post("/messages", classifyMiddleware, (req, res) => {
  const { intent, intentConfidence } = req as typeof req & { intent: string; intentConfidence: number };
  res.json({ routed_to: intent, confidence: intentConfidence });
});

app.listen(3000);`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "Do not create a new TypeSafeClient inside the middleware function — it runs per-request and would create a new TCP connection each time.",
          "Wrap the systemOne call in try/catch and call next(err) on failure so Express error handlers receive it.",
          "If you deploy behind a reverse proxy with a 30 s timeout, ensure the decision call resolves well within it. For scale: a single-question decision on the default embedding engine measured " + ML.embedding1 + " (" + ML.source + "); network time is extra.",
          "Self-host with docker run openjev/engine to avoid external latency on hot paths.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I use this with Fastify or Koa instead of Express?",
        a: "Yes. The TypeSafeClient is framework-agnostic — it makes a standard HTTPS POST. Adapt the middleware signature to the framework's hook API; the systemOne call stays identical.",
      },
      {
        q: "How do I test the middleware in isolation?",
        a: "Mock the TypeSafeClient with a stub that returns a fixed answers object, then run the middleware with a fabricated req/res/next triple. Decisions are deterministic so golden fixtures are stable.",
      },
      {
        q: "Does this block the event loop while the decision is pending?",
        a: "No. systemOne returns a Promise; the middleware is async and yields control while awaiting the response, so the event loop continues serving other requests.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-backends", label: "openjev for backend engineers" },
      { kind: "guide", slug: "noul-primitive", label: "Noul for spam gates" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
      { kind: "use-case", slug: "content-moderation", label: "Content moderation pattern" },
    ],
    updated: UPDATED,
  },
  // ── Python ────────────────────────────────────────────────────────────────
  {
    slug: "fastapi",
    title: "openjev with FastAPI: typed decisions in async Python APIs",
    navLabel: "FastAPI",
    kind: "python",
    category: "Python",
    description:
      "Call the OpenJev HTTP API from a FastAPI endpoint using httpx — classify payloads, gate actions, and return typed decisions alongside your existing Pydantic models.",
    keywords: [
      "fastapi llm classification",
      "openjev fastapi",
      "python typed decision",
      "httpx llm call",
      "fastapi ai classification",
    ],
    intro:
      "FastAPI's async model maps naturally onto openjev: one async httpx call per decision, Pydantic models on both sides of the boundary, and a route that returns a typed verdict your downstream code can act on immediately. No Python SDK is required — the API is plain JSON over HTTPS.",
    takeaways: [
      "Use httpx.AsyncClient as a shared lifespan resource so connections are pooled across requests.",
      "Read OPENJEV_BASE_URL and OPENJEV_API_KEY from the environment at startup.",
      "The raw JSON API accepts the same questions shape as the TypeScript SDK — type, instructions, options.",
      "Pydantic validates your request body before the decision call, so you never hit the API with malformed input.",
    ],
    sections: [
      {
        heading: "Install",
        code: {
          lang: "bash",
          code: `pip install fastapi httpx uvicorn python-dotenv

# .env
OPENJEV_BASE_URL=http://localhost:3000
OPENJEV_API_KEY=your-api-key`,
        },
      },
      {
        heading: "Full working example: ticket classifier endpoint",
        body: "An async POST /classify that calls systemOne over httpx, returning the category, severity, and escalation flag as typed fields.",
        code: {
          lang: "python",
          code: `# main.py
import os
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI
from pydantic import BaseModel

BASE_URL = os.environ["OPENJEV_BASE_URL"]
API_KEY  = os.environ.get("OPENJEV_API_KEY")

http: httpx.AsyncClient  # module-scope, populated in lifespan

@asynccontextmanager
async def lifespan(app: FastAPI):
    global http
    http = httpx.AsyncClient(
        headers={"Authorization": f"Bearer {API_KEY}"} if API_KEY else {},
        timeout=10.0,
    )
    yield
    await http.aclose()

app = FastAPI(lifespan=lifespan)

class TicketIn(BaseModel):
    text: str

@app.post("/classify")
async def classify_ticket(ticket: TicketIn):
    resp = await http.post(
        f"{BASE_URL}/api/v1/systemone",
        json={
            "state": {"ticket": ticket.text},
            "questions": {
                "category": {
                    "type": "choice",
                    "instructions": "Main request in \`ticket\`?",
                    "options": {
                        "refund":    "Customer wants money returned.",
                        "technical": "Reports a bug or outage.",
                        "billing":   "Invoice or payment question.",
                    },
                },
                "urgent": {
                    "type": "noul",
                    "instructions": "Is \`ticket\` urgent?",
                },
                "severity": {
                    "type": "score",
                    "instructions": "Severity of \`ticket\`? (1 low … 5 critical)",
                    "min": 1,
                    "max": 5,
                },
            },
        },
    )
    resp.raise_for_status()
    answers = resp.json()["answers"]
    return {
        "category":   answers["category"]["choice"],
        "confidence": answers["category"]["confidence"],
        "urgent":     answers["urgent"]["noul"] > 0.6,
        "severity":   answers["severity"]["score"],
    }`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "Create httpx.AsyncClient once in the lifespan context, not inside the route — per-request clients leak file descriptors.",
          "Call resp.raise_for_status() before reading the body so 4xx/5xx from the decision engine surface as exceptions, not silent bad data.",
          "If you use Depends for injecting the client, use a module-level singleton wrapped in a Depends(lambda: http) to keep one connection pool.",
          "For CPU-bound backfills, run the engine locally with docker run openjev/engine and set OPENJEV_BASE_URL=http://localhost:3000.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is there a Python SDK, or do I always call the HTTP API directly?",
        a: "You call the HTTP API directly with httpx. The JSON shape is identical to the TypeScript SDK's wire format, so the raw call is clean. A Python SDK client library is on the roadmap.",
      },
      {
        q: "How do I run the decision engine in the same Docker Compose as my FastAPI app?",
        a: "Add the openjev/engine service to your compose file and set OPENJEV_BASE_URL=http://engine:3000 in your FastAPI environment. Decisions never leave your network.",
      },
      {
        q: "Can I use this with Flask instead of FastAPI?",
        a: "Yes. Use httpx.Client (sync) in a Flask route, or run Flask with an async worker. The JSON body and response shape are identical regardless of the Python web framework.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-backends", label: "openjev for backend engineers" },
      { kind: "guide", slug: "choice-primitive", label: "Choice, in depth" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
      { kind: "use-case", slug: "llm-routing", label: "Routing pattern" },
    ],
    updated: UPDATED,
  },
  {
    slug: "django",
    title: "openjev with Django: typed AI decisions in Django REST views",
    navLabel: "Django",
    kind: "python",
    category: "Python",
    description:
      "Call the OpenJev decision API from Django views using httpx — add typed sentiment scoring, spam detection, and content classification to Django REST Framework endpoints.",
    keywords: [
      "django llm classification",
      "django ai view",
      "openjev django",
      "django typed decision",
      "django rest framework llm",
    ],
    intro:
      "Django views process a request and return a response — inserting an OpenJev decision is one extra HTTP call with httpx, placed before (or after) your database work. You get a typed label and a confidence back; your view branches on it and returns whatever Django already returns. No new framework concepts, no ORM changes.",
    takeaways: [
      "Use a module-scope httpx.Client (sync) or httpx.AsyncClient (async Django) so connections are pooled.",
      "Read credentials from Django settings, which read from environment variables.",
      "The raw JSON shape matches the TypeScript SDK wire format exactly — no Python wrapper needed.",
      "Gate expensive view logic (DB writes, emails) behind a Noul decision to block obvious spam.",
    ],
    sections: [
      {
        heading: "Install",
        code: {
          lang: "bash",
          code: `pip install httpx

# settings.py (read from environment, never hardcoded)
import os
OPENJEV_BASE_URL = os.environ["OPENJEV_BASE_URL"]
OPENJEV_API_KEY  = os.environ.get("OPENJEV_API_KEY", "")`,
        },
      },
      {
        heading: "Full working example: review classifier view",
        body: "A class-based Django view that classifies a user review for sentiment, spam, and topic, then returns all three as typed fields without writing a single parsing regex.",
        code: {
          lang: "python",
          code: `# views.py
import json
import httpx
from django.conf import settings
from django.http import JsonResponse
from django.views import View

# One client per process — do not instantiate inside the view method.
_http = httpx.Client(
    headers={"Authorization": f"Bearer {settings.OPENJEV_API_KEY}"}
    if settings.OPENJEV_API_KEY
    else {},
    timeout=10.0,
)

class ClassifyReviewView(View):
    def post(self, request):
        body = json.loads(request.body)
        text = body.get("text", "")

        resp = _http.post(
            f"{settings.OPENJEV_BASE_URL}/api/v1/systemone",
            json={
                "state": {"review": text},
                "questions": {
                    "sentiment": {
                        "type": "score",
                        "instructions": "Sentiment of \`review\`? (1 very negative … 5 very positive)",
                        "min": 1,
                        "max": 5,
                    },
                    "spam": {
                        "type": "noul",
                        "instructions": "Is \`review\` spam or fake?",
                    },
                    "topic": {
                        "type": "choice",
                        "instructions": "Main topic of \`review\`?",
                        "options": {
                            "product":  "About the product quality.",
                            "shipping": "About delivery or logistics.",
                            "support":  "About customer service.",
                        },
                    },
                },
            },
        )
        resp.raise_for_status()
        answers = resp.json()["answers"]

        if answers["spam"]["noul"] > 0.75:
            return JsonResponse({"error": "Review flagged as spam."}, status=400)

        return JsonResponse({
            "sentiment":  answers["sentiment"]["score"],
            "topic":      answers["topic"]["choice"],
            "confidence": answers["topic"]["confidence"],
        })`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "Django's default WSGI mode is synchronous — use httpx.Client (sync). For Django async views, use httpx.AsyncClient.",
          "The module-level _http client is safe across requests in a single worker process because httpx.Client is thread-safe.",
          "Add proper error handling: wrap the httpx call and return a 503 if the decision engine is unreachable, rather than propagating a 5xx.",
          "For unit tests, patch _http.post with a fixture returning a known answers payload so tests never hit a real endpoint.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does this work with Django REST Framework serializers?",
        a: "Yes. Run the systemOne call inside the serializer's validate() or the view's perform_create(). The typed answers are plain Python dicts that you can include in the serializer response data.",
      },
      {
        q: "Can I use Django Signals to classify objects after save?",
        a: "Yes, but run the httpx call in a background task (Celery, Django-Q) rather than in the signal handler itself to avoid blocking the request thread.",
      },
      {
        q: "How do I test without a live OpenJev endpoint?",
        a: "Mock httpx.Client.post in your test with unittest.mock.patch, returning a Response with a canned answers JSON. Decisions are deterministic so golden outputs are stable across test runs.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-data-teams", label: "openjev for data teams" },
      { kind: "guide", slug: "score-primitive", label: "Score for sentiment ratings" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
      { kind: "use-case", slug: "content-moderation", label: "Content moderation pattern" },
    ],
    updated: UPDATED,
  },
  // ── LangChain ─────────────────────────────────────────────────────────────
  {
    slug: "langchain-js",
    title: "openjev with LangChain.js: typed routing and verification nodes",
    navLabel: "LangChain.js",
    kind: "js-ts",
    category: "LangChain",
    description:
      "Replace brittle StringOutputParser routing nodes in a LangChain.js graph with typed OpenJev decisions — get a Choice for the next tool and a Noul for step verification.",
    keywords: [
      "langchain typed decision",
      "langchainjs routing",
      "langgraph decision node",
      "openjev langchain",
      "langchain structured output alternative",
    ],
    intro:
      "LangChain.js graphs break down at the routing and verification nodes: you ask the LLM which tool to call next and parse the reply — a fragile pattern that fails on edge cases and makes runs unreproducible. Replacing those nodes with typed OpenJev decisions gives you a distribution over your actual tool set, a confidence to threshold, and deterministic behavior for the same agent state.",
    takeaways: [
      "Create a route node as a RunnableLambda that calls systemOne and returns the next step as a typed value.",
      "Use a Noul for step verification: did the tool output satisfy the current step?",
      "Typed decisions are deterministic — the same state always routes the same way, making agent trajectories testable.",
      "The decision call is generation-free and cheap enough to run on every loop iteration without inflating latency.",
    ],
    sections: [
      {
        heading: "Install",
        code: {
          lang: "bash",
          code: `npm install @caelum/typesafe @langchain/core langchain
# For OpenAI generation nodes (not required for the decision nodes):
npm install @langchain/openai`,
        },
      },
      {
        heading: "Typed route node",
        body: "A RunnableLambda that uses a Choice to decide the next action and a Noul to check whether the current result is sufficient — no StringOutputParser, no text splitting.",
        code: {
          lang: "ts",
          code: `import { RunnableLambda } from "@langchain/core/runnables";
import { TypeSafeClient, choice, noul } from "@caelum/typesafe";

const decisions = new TypeSafeClient({
  baseUrl: process.env.OPENJEV_BASE_URL!,
  apiKey: process.env.OPENJEV_API_KEY,
});

interface AgentState {
  query: string;
  lastResult: string;
  steps: number;
}

export const routeNode = RunnableLambda.from(
  async (state: AgentState): Promise<AgentState & { nextStep: string; done: boolean }> => {
    const { answers } = await decisions.systemOne({
      state: { query: state.query, lastResult: state.lastResult },
      questions: {
        next: choice("Which action best advances \`query\` given \`lastResult\`?", {
          search:    "Retrieve more information from the web.",
          calculate: "Run a data transformation or calculation.",
          answer:    "Sufficient context; formulate the final answer.",
          clarify:   "The query is ambiguous; ask for clarification.",
        }),
        done: noul("Does \`lastResult\` fully and correctly answer \`query\`?"),
      },
    });

    return {
      ...state,
      nextStep: answers.next.choice,
      done: answers.done.noul > 0.85 || state.steps >= 10,
    };
  },
);`,
        },
      },
      {
        heading: "Wire into a LangGraph graph",
        code: {
          lang: "ts",
          code: `import { StateGraph } from "@langchain/langgraph";

const graph = new StateGraph({ channels: {} })
  .addNode("route", routeNode)
  .addNode("search", searchNode)
  .addNode("calculate", calcNode)
  .addNode("answer", answerNode)
  .addConditionalEdges("route", (state) => {
    if (state.done) return "answer";
    return state.nextStep; // "search" | "calculate" | "clarify"
  })
  .addEdge("search", "route")
  .addEdge("calculate", "route")
  .setEntryPoint("route");`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "The TypeSafeClient must be instantiated outside the RunnableLambda callback — inside would create a new client on every invocation.",
          "LangGraph's checkpointer serializes state; typed decision answers are plain objects and serialize correctly.",
          "If the agent state is large, trim it before passing to systemOne — only pass the fields the questions actually reference.",
          "Use answers.next.confidence < 0.5 as a signal to add a clarify step rather than routing blindly on the top answer.",
        ],
      },
    ],
    faqs: [
      {
        q: "Should I replace all LangChain nodes with typed decisions?",
        a: "Only the routing and verification nodes — the ones that decide what to do next, not ones that generate content. Keep your generative LLM nodes (ChatOpenAI, etc.) for steps that actually produce text.",
      },
      {
        q: "Does this work with LangGraph.js state machines?",
        a: "Yes. addConditionalEdges takes a function that reads state; that function can read the nextStep field the typed route node wrote, making graph transitions fully typed.",
      },
      {
        q: "How does this help with reproducibility?",
        a: "A typed decision is deterministic for a given state and questions. Recording the agent state at each step means you can replay the trajectory and get identical routing decisions, which makes debugging agent failures tractable.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-agents", label: "openjev for AI agents" },
      { kind: "guide", slug: "choice-primitive", label: "Choice for routing" },
      { kind: "use-case", slug: "function-calling", label: "Tool selection pattern" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
    ],
    updated: UPDATED,
  },
  {
    slug: "langchain-python",
    title: "openjev with LangChain Python: typed routing in Python agent graphs",
    navLabel: "LangChain Python",
    kind: "python",
    category: "LangChain",
    description:
      "Replace LangChain Python routing chains with typed OpenJev decisions — a plain httpx call returns a Choice for next action and a Noul for step completion, deterministic every run.",
    keywords: [
      "langchain python typed decision",
      "langgraph python routing",
      "openjev python",
      "python agent decision",
      "langchain structured output python",
    ],
    intro:
      "LangChain Python agent graphs share the same routing problem as their JS counterpart: a chain that returns plain text needs parsing, breaks across model versions, and makes runs unreproducible. A typed decision node calls OpenJev over httpx, returns a Python dict with typed answers, and routes on values — not parsed strings.",
    takeaways: [
      "Write the routing node as a plain Python function that calls systemOne over httpx and returns augmented state.",
      "Use a shared httpx.Client at module scope — pass it into the node via a closure to avoid re-creating it.",
      "The JSON shape is identical to the TS SDK wire format — no Python-specific API to learn.",
      "Identical state → identical routing, making trajectory tests deterministic.",
    ],
    sections: [
      {
        heading: "Install",
        code: {
          lang: "bash",
          code: `pip install langchain-core langgraph httpx
# For OpenAI generation nodes:
pip install langchain-openai`,
        },
      },
      {
        heading: "Typed route node",
        body: "A plain Python function used as a LangGraph node that returns next_action and task_complete typed fields, replacing a StringOutputParser chain.",
        code: {
          lang: "python",
          code: `# nodes/route.py
import os, httpx
from typing import TypedDict

BASE_URL = os.environ["OPENJEV_BASE_URL"]
API_KEY  = os.environ.get("OPENJEV_API_KEY")

_http = httpx.Client(
    headers={"Authorization": f"Bearer {API_KEY}"} if API_KEY else {},
    timeout=10.0,
)

class AgentState(TypedDict):
    query: str
    last_result: str
    next_action: str
    task_complete: bool

def route_node(state: AgentState) -> AgentState:
    resp = _http.post(
        f"{BASE_URL}/api/v1/systemone",
        json={
            "state": {
                "query":       state["query"],
                "last_result": state["last_result"],
            },
            "questions": {
                "next_action": {
                    "type": "choice",
                    "instructions": "Best action given \`query\` and \`last_result\`?",
                    "options": {
                        "search":    "Retrieve more information.",
                        "calculate": "Run a computation on existing data.",
                        "answer":    "Formulate the final answer — enough context exists.",
                        "clarify":   "Ask the user a clarifying question.",
                    },
                },
                "task_complete": {
                    "type": "noul",
                    "instructions": "Does \`last_result\` fully answer \`query\`?",
                },
            },
        },
    )
    resp.raise_for_status()
    answers = resp.json()["answers"]
    return {
        **state,
        "next_action":   answers["next_action"]["choice"],
        "task_complete": answers["task_complete"]["noul"] > 0.85,
    }`,
        },
      },
      {
        heading: "Wire into a LangGraph graph",
        code: {
          lang: "python",
          code: `from langgraph.graph import StateGraph, END
from nodes.route import route_node, AgentState

def should_continue(state: AgentState) -> str:
    if state["task_complete"]:
        return "answer"
    return state["next_action"]  # "search" | "calculate" | "clarify"

graph = StateGraph(AgentState)
graph.add_node("route", route_node)
graph.add_node("search", search_node)
graph.add_node("calculate", calc_node)
graph.add_node("answer", answer_node)
graph.add_conditional_edges("route", should_continue)
graph.add_edge("search", "route")
graph.add_edge("calculate", "route")
graph.set_entry_point("route")
app = graph.compile()`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "Create _http at module scope, not inside route_node — each call would create a new TCP connection otherwise.",
          "LangGraph serializes state as a dict; TypedDict fields are plain Python types and serialize cleanly.",
          "Pass only the fields the decision questions reference in the state argument — large state objects slow the POST.",
          "For async LangGraph graphs, switch to httpx.AsyncClient and make route_node an async function.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I use this with the older LangChain Expression Language (LCEL) instead of LangGraph?",
        a: "Yes. Wrap route_node as a RunnableLambda. The node receives the chain input dict and returns an augmented dict the next runnable can read.",
      },
      {
        q: "How do I write a regression test for an agent trajectory?",
        a: "Record the state at each step of a reference run. In the test, replay those states through route_node and assert next_action matches — since decisions are deterministic, the replay is exact.",
      },
      {
        q: "Can the same endpoint run on laya-onnx locally?",
        a: "Yes. Point OPENJEV_BASE_URL at your self-hosted engine (docker run openjev/engine). The JSON shape is identical; only the URL changes.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-agents", label: "openjev for AI agents" },
      { kind: "guide", slug: "noul-primitive", label: "Noul for verification" },
      { kind: "use-case", slug: "llm-routing", label: "Routing pattern" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
    ],
    updated: UPDATED,
  },
  {
    slug: "vercel-ai-sdk",
    title: "openjev with the Vercel AI SDK: typed gates before streaming",
    navLabel: "Vercel AI SDK",
    kind: "js-ts",
    category: "Vercel AI SDK",
    description:
      "Use typed OpenJev decisions as a pre-generation gate in Vercel AI SDK route handlers — classify intent, block off-topic requests, and stream only when the typed check passes.",
    keywords: [
      "vercel ai sdk typed decision",
      "ai sdk llm gate",
      "openjev vercel ai",
      "streamtext gate",
      "ai sdk classification",
    ],
    intro:
      "The Vercel AI SDK handles generative streaming well; it handles gating and routing poorly — those steps are not generation and should not be treated as such. A typed OpenJev decision before the streamText call classifies the message, checks policy, and decides whether to stream at all — all without producing a single generated token for the non-generative steps.",
    takeaways: [
      "Run the typed gate decision before calling streamText — only pay for generation on requests that pass.",
      "Gate on choice (topic, intent) and noul (safety, policy) in one systemOne call.",
      "The TypeSafeClient and the AI SDK client are independent — use both in the same route handler.",
      "For Edge Runtime, use the raw fetch approach (same JSON body) if the Node SDK is unavailable.",
    ],
    sections: [
      {
        heading: "Install",
        code: {
          lang: "bash",
          code: `npm install @caelum/typesafe ai @ai-sdk/openai`,
        },
      },
      {
        heading: "Full working example: gated chat route",
        body: "A POST /api/chat that runs a typed gate before streaming — classifies topic and checks safety, then only streams if both pass. One systemOne call, no extra round trips.",
        code: {
          lang: "ts",
          code: `// app/api/chat/route.ts
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { TypeSafeClient, choice, noul } from "@caelum/typesafe";

const decisions = new TypeSafeClient({
  baseUrl: process.env.OPENJEV_BASE_URL ?? "http://localhost:3000",
  apiKey: process.env.OPENJEV_API_KEY,
});

export const runtime = "nodejs"; // use "edge" with raw fetch if preferred

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: { role: string; content: string }[] };
  const last = messages.at(-1)?.content ?? "";

  // Typed gate: one call, two decisions.
  const { answers } = await decisions.systemOne({
    state: { message: last },
    questions: {
      safe: noul(
        "Is \`message\` free of harmful, illegal, or deeply offensive content?",
      ),
      topic: choice("Topic of \`message\`?", {
        product:  "About product features or usage.",
        billing:  "About pricing, payment, or subscription.",
        offtopic: "Unrelated to the product.",
      }),
    },
  });

  // Block unsafe or off-topic messages before any generation cost.
  if (answers.safe.noul < 0.6) {
    return new Response("Request declined.", { status: 200 });
  }
  if (answers.topic.choice === "offtopic" && answers.topic.confidence > 0.75) {
    return new Response("I can only help with product and billing questions.", { status: 200 });
  }

  // Gate passed: stream the generative response.
  return streamText({
    model: openai("gpt-4o"),
    system: answers.topic.choice === "billing"
      ? "You are a billing support agent."
      : "You are a helpful product assistant.",
    messages: messages as Parameters<typeof streamText>[0]["messages"],
  }).toDataStreamResponse();
}`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "Declare decisions = new TypeSafeClient(...) at module scope, not inside the handler — the handler runs per request.",
          "Edge Runtime (runtime = 'edge') does not include Node.js APIs; use raw fetch with the same JSON body instead of the SDK.",
          "The systemOne call resolves before streamText is called — there is no concurrent gate + stream race.",
          "Confidence thresholds for offtopic are intentionally high (0.75) to avoid blocking borderline messages — tune to your product's needs.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I use this with other AI SDK providers like Anthropic or Mistral?",
        a: "Yes. The OpenJev gate is independent of the AI SDK model provider. Swap openai('gpt-4o') for anthropic('claude-3-5-sonnet') or any other provider — the gate runs first and the provider is only invoked if it passes.",
      },
      {
        q: "What if the gate itself is slow and adds latency to the stream start?",
        a: "Self-host the engine (docker run openjev/engine) and point OPENJEV_BASE_URL at your local deployment. A single-question decision on the default embedding engine measured " + ML.embedding1 + " (" + ML.source + "), small next to the time to first token of a streaming call.",
      },
      {
        q: "Can I run the gate and the stream concurrently?",
        a: "Not safely — you need the gate result before deciding whether to stream. Run them sequentially. The gate adds its engine time (" + ML.embedding1 + " per single-question decision on the default embedding engine; " + ML.source + ") plus the network hop to wherever it runs; measure both from your deployment.",
      },
    ],
    related: [
      { kind: "guide", slug: "noul-primitive", label: "Noul for policy gates" },
      { kind: "guide", slug: "jev-out-of-scope-inputs", label: "Abstain on off-topic input" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
      { kind: "use-case", slug: "content-moderation", label: "Content moderation pattern" },
    ],
    updated: UPDATED,
  },
  // ── Edge runtimes ─────────────────────────────────────────────────────────
  {
    slug: "cloudflare-workers",
    title: "openjev on Cloudflare Workers: typed decisions at the edge",
    navLabel: "Cloudflare Workers",
    kind: "edge",
    category: "Edge",
    description:
      "Call the OpenJev HTTP API from a Cloudflare Worker using the native fetch API — classify traffic, gate requests, and route at the edge with typed decisions and no Node.js dependency.",
    keywords: [
      "cloudflare workers llm",
      "edge classification",
      "openjev cloudflare",
      "worker typed decision",
      "cloudflare ai classification",
    ],
    intro:
      "Cloudflare Workers run V8 isolates at the edge with no Node.js runtime — but they have the global fetch API, which is all OpenJev needs. A typed decision in a Worker is a fetch POST to the decision engine, two JSON manipulations, and a gate: no SDK, no npm install, no Node.js shims.",
    takeaways: [
      "Use the native fetch API — no npm install or Node.js shims required in a Worker.",
      "Store OPENJEV_BASE_URL and OPENJEV_API_KEY as Wrangler secrets, not plain text in wrangler.toml.",
      "A Worker that calls a self-hosted engine in the same region keeps the network hop short; the engine itself measured " + ML.embedding1 + " per single-question decision (" + ML.source + ").",
      "The raw JSON API shape is the same wire format as the TypeScript SDK — no adapter layer.",
    ],
    sections: [
      {
        heading: "Configure secrets",
        code: {
          lang: "bash",
          code: `# wrangler.toml — no secrets here, only the binding names
[vars]
# keep empty; use wrangler secret put instead

# Store secrets via Wrangler CLI (never commit values):
wrangler secret put OPENJEV_BASE_URL
wrangler secret put OPENJEV_API_KEY`,
        },
      },
      {
        heading: "Full working example: edge request classifier",
        body: "A Worker that classifies an inbound JSON body, rejects spam, and routes to the correct origin — no npm, no SDK, plain fetch.",
        code: {
          lang: "ts",
          code: `// src/index.ts
export interface Env {
  OPENJEV_BASE_URL: string;
  OPENJEV_API_KEY?: string;
}

interface AnswerChoice  { choice: string; confidence: number; probabilities: Record<string, number> }
interface AnswerNoul    { noul: number }
interface Answers {
  category: AnswerChoice;
  spam:     AnswerNoul;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const { text } = await request.json<{ text: string }>();

    const resp = await fetch(\`\${env.OPENJEV_BASE_URL}/api/v1/systemone\`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.OPENJEV_API_KEY
          ? { Authorization: \`Bearer \${env.OPENJEV_API_KEY}\` }
          : {}),
      },
      body: JSON.stringify({
        state: { text },
        questions: {
          category: {
            type: "choice",
            instructions: "Category of \`text\`?",
            options: {
              support: "Technical or account issue.",
              billing: "Payment or invoice question.",
              other:   "None of the above.",
            },
          },
          spam: {
            type: "noul",
            instructions: "Is \`text\` spam or unsolicited content?",
          },
        },
      }),
    });

    const { answers } = await resp.json<{ answers: Answers }>();

    if (answers.spam.noul > 0.8) {
      return new Response("Rejected.", { status: 400 });
    }

    return Response.json({
      category:   answers.category.choice,
      confidence: answers.category.confidence,
    });
  },
};`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "Workers have a 128 MB memory limit and no filesystem — the raw fetch approach avoids any bundler overhead entirely.",
          "If you use the @caelum/typesafe npm package via a bundler, ensure you target the browser/edge export condition, not the Node.js one.",
          "Point OPENJEV_BASE_URL at a Cloudflare-hosted or same-region endpoint to minimize cross-region latency.",
          "Use wrangler secret put for API keys — never put secrets in wrangler.toml vars, which are committed to source control.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I use the @caelum/typesafe SDK in a Worker?",
        a: "The raw fetch approach shown above requires no npm at all. If you prefer the SDK, bundle it with Wrangler — the SDK targets standard fetch and works in Workers when bundled with the edge export condition.",
      },
      {
        q: "Where should I run the decision engine for lowest latency?",
        a: "Deploy the OpenJev engine on Cloudflare Workers (via the Docker-to-Workers migration path) or on a Cloudflare-connected server in the same region as your Worker. Cross-region calls add a full inter-region round-trip on every decision.",
      },
      {
        q: "Does this work in Cloudflare Pages Functions too?",
        a: "Yes. Pages Functions use the same Workers runtime — the same fetch-based example works without modification.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-backends", label: "openjev for backend engineers" },
      { kind: "guide", slug: "cheap-deterministic-classification", label: "Cheap deterministic classification" },
      { kind: "doc", slug: "self-hosting", label: "Self-hosting the engine" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
    ],
    updated: UPDATED,
  },
  {
    slug: "deno-deploy",
    title: "openjev on Deno Deploy: typed decisions in Deno HTTP servers",
    navLabel: "Deno Deploy",
    kind: "edge",
    category: "Edge",
    description:
      "Use the OpenJev decision API from a Deno Deploy server — classify documents, detect PII, and score quality using the native Deno fetch API with typed JSON responses.",
    keywords: [
      "deno deploy llm",
      "deno typed decision",
      "openjev deno",
      "deno ai classification",
      "deno fetch llm api",
    ],
    intro:
      "Deno Deploy servers use the native fetch API and read secrets from Deno.env — the same shape as any edge runtime. An OpenJev decision is one fetch call with a JSON body, no npm install, and no Node.js compatibility layer. You get typed answers back as plain JSON and branch on them with TypeScript's narrowing.",
    takeaways: [
      "Read OPENJEV_BASE_URL and OPENJEV_API_KEY from Deno.env — add them in the Deno Deploy dashboard.",
      "No npm install: the OpenJev API is plain JSON over fetch, compatible with any Deno runtime.",
      "Deno.serve handles async handlers natively — await the fetch call inline.",
      "Deploy with deployctl; decisions work identically on local Deno and Deno Deploy.",
    ],
    sections: [
      {
        heading: "Configure environment variables",
        code: {
          lang: "bash",
          code: `# Local development (deno run --allow-env --allow-net):
export OPENJEV_BASE_URL=http://localhost:3000
export OPENJEV_API_KEY=your-api-key

# Deno Deploy: add these in the project dashboard → Settings → Environment Variables`,
        },
      },
      {
        heading: "Full working example: document enrichment server",
        body: "A Deno.serve handler that classifies a document's language, detects PII, and scores its writing quality — three typed decisions in one POST.",
        code: {
          lang: "ts",
          code: `// main.ts
const BASE_URL = Deno.env.get("OPENJEV_BASE_URL") ?? "http://localhost:3000";
const API_KEY  = Deno.env.get("OPENJEV_API_KEY");

interface Answers {
  language: { choice: string; confidence: number };
  pii:      { noul: number };
  quality:  { score: number; confidence: number };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { document } = await req.json() as { document: string };

  const resp = await fetch(\`\${BASE_URL}/api/v1/systemone\`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: \`Bearer \${API_KEY}\` } : {}),
    },
    body: JSON.stringify({
      state: { document },
      questions: {
        language: {
          type: "choice",
          instructions: "Primary language of \`document\`?",
          options: {
            en:    "English",
            es:    "Spanish",
            de:    "German",
            fr:    "French",
            other: "Another language.",
          },
        },
        pii: {
          type: "noul",
          instructions:
            "Does \`document\` contain personally identifiable information (names, emails, phone numbers, addresses)?",
        },
        quality: {
          type: "score",
          instructions: "Writing quality of \`document\`? (1 very poor … 5 excellent)",
          min: 1,
          max: 5,
        },
      },
    }),
  });

  if (!resp.ok) {
    return new Response("Decision engine error.", { status: 502 });
  }

  const { answers } = await resp.json() as { answers: Answers };

  return Response.json({
    language:    answers.language.choice,
    confidence:  answers.language.confidence,
    hasPII:      answers.pii.noul > 0.5,
    quality:     answers.quality.score,
  });
});`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "Deno Deploy processes are short-lived — there is no module-scope connection pool across requests. Use a new fetch call per request (the overhead is negligible for HTTPS/2 keep-alive).",
          "Run locally with deno run --allow-net --allow-env main.ts to test before deploying.",
          "If OPENJEV_BASE_URL is not set, the code falls back to the hosted API — ensure your Deploy project has the variable set in production.",
          "Deno's TypeScript support means you can define typed Answers interfaces (as shown) and get compile-time safety on the response shape.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I use the npm @caelum/typesafe package in Deno?",
        a: "Yes, via npm: specifiers (import { TypeSafeClient } from 'npm:@caelum/typesafe'). The raw fetch approach shown here needs no npm at all and is simpler for a Deploy function.",
      },
      {
        q: "How do I self-host the engine and call it from Deno Deploy?",
        a: "Deploy the Docker image to any server with a public HTTPS endpoint and set OPENJEV_BASE_URL to that URL in your Deno Deploy environment variables. The JSON body is identical regardless of where the engine runs.",
      },
      {
        q: "Does this work in a Fresh (Deno web framework) route handler?",
        a: "Yes. Fresh route handlers are standard Deno request handlers. Place the fetch call inside the handler function exactly as shown.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-data-teams", label: "openjev for data teams" },
      { kind: "guide", slug: "noul-primitive", label: "Noul for PII detection" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
      { kind: "doc", slug: "self-hosting", label: "Self-hosting the engine" },
    ],
    updated: UPDATED,
  },
  {
    slug: "supabase-edge-functions",
    title: "openjev with Supabase Edge Functions: classify and persist in one step",
    navLabel: "Supabase Edge Functions",
    kind: "edge",
    category: "Edge",
    description:
      "Call the OpenJev API from a Supabase Edge Function to classify user-generated content, then write the typed verdict back to Postgres in the same function invocation.",
    keywords: [
      "supabase edge function llm",
      "supabase ai classification",
      "openjev supabase",
      "edge function typed decision",
      "supabase postgres classification",
    ],
    intro:
      "Supabase Edge Functions run Deno at the edge with direct access to your Postgres database via the Supabase client. Pairing them with OpenJev lets you classify inbound content — a post, a review, a support ticket — and write the typed decision (category, moderation flag, quality score) back to a Postgres column in the same invocation: one network hop per event.",
    takeaways: [
      "The Edge Function calls systemOne over fetch, reads typed answers, and upserts them to a Postgres classification table.",
      "Store OPENJEV_BASE_URL and OPENJEV_API_KEY via supabase secrets set — never inline them.",
      "The Supabase JS client (SUPABASE_SERVICE_ROLE_KEY) lets the function bypass RLS for the classification write.",
      "Invoke the function from a database webhook or a client trigger so every new row is classified automatically.",
    ],
    sections: [
      {
        heading: "Set secrets",
        code: {
          lang: "bash",
          code: `supabase secrets set OPENJEV_BASE_URL=http://localhost:3000
supabase secrets set OPENJEV_API_KEY=your-api-key
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.`,
        },
      },
      {
        heading: "Full working example: classify-post function",
        body: "An Edge Function that receives a post_id and content, calls systemOne for category, moderation flag, and quality score, then upserts the results into a post_classifications table.",
        code: {
          lang: "ts",
          code: `// supabase/functions/classify-post/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BASE_URL = Deno.env.get("OPENJEV_BASE_URL") ?? "http://localhost:3000";
const API_KEY  = Deno.env.get("OPENJEV_API_KEY");
const SB_URL   = Deno.env.get("SUPABASE_URL")!;
const SB_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Answers {
  category:   { choice: string; confidence: number };
  moderation: { noul: number };
  quality:    { score: number };
}

serve(async (req: Request): Promise<Response> => {
  const { post_id, content } = await req.json() as { post_id: string; content: string };

  // 1. Classify the content.
  const decisionResp = await fetch(\`\${BASE_URL}/api/v1/systemone\`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: \`Bearer \${API_KEY}\` } : {}),
    },
    body: JSON.stringify({
      state: { content },
      questions: {
        category: {
          type: "choice",
          instructions: "Category of \`content\`?",
          options: {
            technical: "Programming or technical discussion.",
            business:  "Business, marketing, or growth topics.",
            offtopic:  "Off-topic or irrelevant.",
          },
        },
        moderation: {
          type: "noul",
          instructions: "Does \`content\` violate community guidelines (spam, hate, abuse)?",
        },
        quality: {
          type: "score",
          instructions: "Overall content quality? (1 very low … 5 high)",
          min: 1,
          max: 5,
        },
      },
    }),
  });

  if (!decisionResp.ok) {
    return new Response("Classification failed.", { status: 502 });
  }

  const { answers } = await decisionResp.json() as { answers: Answers };

  // 2. Persist the typed verdict to Postgres.
  const db = createClient(SB_URL, SB_KEY);
  const { error } = await db.from("post_classifications").upsert({
    post_id,
    category:         answers.category.choice,
    confidence:       answers.category.confidence,
    moderation_flag:  answers.moderation.noul > 0.6,
    quality:          answers.quality.score,
    classified_at:    new Date().toISOString(),
  });

  if (error) return new Response(error.message, { status: 500 });

  return Response.json({ ok: true, category: answers.category.choice });
});`,
        },
      },
      {
        heading: "Gotchas",
        bullets: [
          "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically in deployed Edge Functions — you do not need to set them manually.",
          "Use SUPABASE_SERVICE_ROLE_KEY (not the anon key) for the classification write so the function bypasses RLS and can always insert.",
          "Create the post_classifications table with a migration before deploying: post_id text primary key, category text, confidence real, moderation_flag boolean, quality int, classified_at timestamptz.",
          "Invoke the function from a Supabase database webhook on the posts table INSERT event so every new post is classified automatically.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I invoke this function from a database webhook instead of the client?",
        a: "Yes. Create a Supabase webhook on the posts table INSERT event pointing at the function URL. The webhook payload includes the new row's columns, which you pass as content.",
      },
      {
        q: "How do I query only high-quality, non-flagged posts?",
        a: "Join posts with post_classifications and filter WHERE moderation_flag = false AND quality >= 3 AND confidence >= 0.7. The calibrated confidence column lets you exclude uncertain classifications from user-facing feeds.",
      },
      {
        q: "Can I run this against a local Supabase instance?",
        a: "Yes. Run supabase start, set OPENJEV_BASE_URL=http://localhost:3000 pointing at a local engine, and invoke the function with supabase functions serve classify-post.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-data-teams", label: "openjev for data teams" },
      { kind: "guide", slug: "noul-primitive", label: "Noul for moderation gates" },
      { kind: "doc", slug: "self-hosting", label: "Self-hosting the engine" },
      { kind: "use-case", slug: "content-moderation", label: "Content moderation pattern" },
    ],
    updated: UPDATED,
  },
  ...PACKAGE_INTEGRATIONS,
];

export function integrationBySlug(slug: string): Integration | undefined {
  return INTEGRATIONS.find((i) => i.slug === slug);
}

export const INTEGRATION_SLUGS: readonly string[] = INTEGRATIONS.map((i) => i.slug);

const INTEGRATION_GROUP_DEFS: ReadonlyArray<{ kind: IntegrationKind; label: string }> = [
  { kind: "js-ts", label: "JavaScript / TypeScript" },
  { kind: "python", label: "Python" },
  { kind: "edge", label: "Edge runtimes" },
];

export const INTEGRATION_GROUPS: ReadonlyArray<{
  kind: IntegrationKind;
  label: string;
  integrations: readonly Integration[];
}> = INTEGRATION_GROUP_DEFS.map((g) => ({
  ...g,
  integrations: INTEGRATIONS.filter((x) => x.kind === g.kind),
}));
