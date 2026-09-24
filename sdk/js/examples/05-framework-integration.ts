/**
 * Framework integration: reusable handler factory.
 *
 * Shows how to wire TypeSafeClient into a server-side HTTP framework.
 * The pattern is framework-agnostic: construct the client once at module
 * scope (shared connection pool + retry state), then call it inside each
 * request handler.
 *
 * The example below uses Node.js's built-in `node:http` to stand up a
 * minimal server; the same client instance drops into Next.js Route Handlers,
 * Express middleware, Hono handlers, or any other async function that owns
 * the request/response lifecycle.
 *
 * Run with:
 *   OPENJEV_API_KEY=<key> npx tsx examples/05-framework-integration.ts
 *
 * Then test:
 *   curl -s -X POST http://localhost:3001/analyze \
 *     -H "Content-Type: application/json" \
 *     -d '{"text":"I was overcharged this month and I am furious."}'
 */
import { createServer } from "node:http";
import {
  APIError,
  BadRequestError,
  choice,
  noul,
  OpenJevClient,
  OpenJevError,
  score,
} from "../src";

// --- Singleton client -- construct once, reuse across requests. -----------

const client = new OpenJevClient({
  timeout: 12_000,
  retry: { maxRetries: 3 },
  logLevel: "warn",
});

// --- Analysis helper -------------------------------------------------------

interface AnalysisInput {
  text: string;
}

interface AnalysisOutput {
  billing: number;
  sentiment: "calm" | "frustrated" | "angry";
  sentimentConfidence: number;
  urgency: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

async function analyze(input: AnalysisInput): Promise<AnalysisOutput> {
  const { answers, model, usage } = await client.systemOne({
    state: input.text,
    questions: {
      billing: noul("Is this message about a billing or payment issue?"),
      sentiment: choice("What is the overall emotional tone?", {
        calm: "Neutral or positive language",
        frustrated: "Mild irritation or dissatisfaction",
        angry: "Strong anger or hostility",
      }),
      urgency: score("How urgently does this need attention?", [
        "low — can wait",
        "medium — today",
        "high — within the hour",
      ]),
    },
  });

  return {
    billing: answers.billing.noul,
    sentiment: answers.sentiment.choice,
    sentimentConfidence: answers.sentiment.confidence,
    urgency: answers.urgency.score,
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}

// --- HTTP server -----------------------------------------------------------

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/analyze") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    void (async () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      if (
        typeof body !== "object" ||
        body === null ||
        typeof (body as Record<string, unknown>).text !== "string"
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: 'Body must be { "text": "..." }' }));
        return;
      }

      try {
        const result = await analyze({ text: (body as { text: string }).text });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        if (err instanceof BadRequestError) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        } else if (err instanceof APIError) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Upstream API error", detail: err.message }));
        } else if (err instanceof OpenJevError) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal error" }));
        }
      }
    })();
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${String(PORT)}`);
  console.log(
    "Try: curl -s -X POST http://localhost:3001/analyze" +
      ' -H "Content-Type: application/json"' +
      ' -d \'{"text":"I was overcharged this month."}\'',
  );
});
