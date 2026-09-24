/**
 * Error handling and retry configuration.
 *
 * Covers:
 *   - Catching typed API errors (AuthenticationError, RateLimitError, etc.)
 *   - Custom retry policy per-client and per-call
 *   - Aborting a request with AbortSignal
 *   - Per-call timeout override
 *
 * Run with:
 *   OPENJEV_API_KEY=<key> npx tsx examples/04-error-handling.ts
 */
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  noul,
  OpenJevClient,
  RateLimitError,
} from "../src";

// --- 1. Typed error handling --------------------------------------------

const client = new OpenJevClient();

try {
  await client.systemOne({
    state: "Is this working?",
    questions: { test: noul("Is this a test?") },
  });
} catch (err) {
  if (err instanceof AuthenticationError) {
    // 401: wrong or missing API key
    console.error("Authentication failed — check OPENJEV_API_KEY:", err.message);
  } else if (err instanceof RateLimitError) {
    // 429: back off; the SDK already retried per the default policy
    const wait = err.retryAfterMs !== undefined ? ` (retry after ${err.retryAfterMs}ms)` : "";
    console.error(`Rate limit hit${wait}:`, err.message);
  } else if (err instanceof APITimeoutError) {
    console.error(`Timed out after ${err.timeoutMs}ms:`, err.message);
  } else if (err instanceof APIConnectionError) {
    console.error("Network error:", err.message);
  } else if (err instanceof APIError) {
    // Any other non-2xx response
    console.error(`API error ${err.status} (request ${err.requestId ?? "unknown"}):`, err.body);
  } else {
    throw err; // Re-throw unexpected errors
  }
}

// --- 2. Custom retry policy ------------------------------------------------

// Increase retries for a long-running batch job; tighten timeout per attempt.
const resilientClient = new OpenJevClient({
  timeout: 15_000,
  retry: {
    maxRetries: 5,
    backoffInitialMs: 1_000,
    backoffMaxMs: 30_000,
    backoffJitter: 0.3,
  },
});

// Per-call override: disable retries for a latency-sensitive path.
try {
  await resilientClient.systemOne(
    {
      state: "Quick check",
      questions: { ok: noul("Is this okay?") },
    },
    { retry: { maxRetries: 0 }, timeout: 3_000 },
  );
} catch (err) {
  if (err instanceof APIError) {
    console.error("No-retry call failed:", err.message);
  }
}

// --- 3. AbortSignal: cancel in-flight requests ----------------------------

const controller = new AbortController();

// Cancel the request after 500 ms regardless of the configured timeout.
const cancelTimer = setTimeout(() => {
  controller.abort(new Error("User navigated away"));
}, 500);

try {
  await client.systemOne(
    {
      state: "A slower analysis",
      questions: { relevant: noul("Is this content relevant?") },
    },
    { signal: controller.signal },
  );
} catch (err) {
  if (err instanceof APIUserAbortError) {
    console.log("Request cancelled by caller:", err.message);
  } else {
    throw err;
  }
} finally {
  clearTimeout(cancelTimer);
}
