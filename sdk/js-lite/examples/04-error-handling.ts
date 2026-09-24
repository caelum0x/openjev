/**
 * Error handling and retries.
 *
 * Shows how to catch and respond to the TypeSafe error hierarchy:
 *   - RateLimitError: throttled by the API (retryAfterMs tells you when to retry)
 *   - TimeoutError: request exceeded the configured timeoutMs
 *   - AuthenticationError: bad or missing API key
 *   - ValidationError: malformed request (bad question definition, etc.)
 *   - NetworkError: transport-level failure
 *   - AbortError: AbortController cancelled the request
 *
 * The client handles transient failures (429 / 5xx / network) automatically with
 * exponential backoff. These examples deal with the cases that fall through or
 * need application-level handling.
 *
 * Run: tsx examples/04-error-handling.ts
 * Requires: TYPESAFE_API_KEY in env (intentionally wrong key in one example).
 */

import {
  TypeSafeClient,
  noul,
  RateLimitError,
  AuthenticationError,
  ValidationError,
  TimeoutError,
  AbortError,
  NetworkError,
  TypeSafeError,
  retryAfterMs,
} from '../src/index.ts';

// ---- Helper: sleep --------------------------------------------------------
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---- 1. Catch a RateLimitError and back off manually ----------------------
//
// The client already retries up to `maxRetries` times with jitter-backoff. If the
// rate limit persists beyond the retry budget, a RateLimitError is thrown. The
// `retryAfterMs(error)` helper extracts the Retry-After header value.

async function callWithRateLimitHandling(client: TypeSafeClient): Promise<void> {
  const MAX_APPLICATION_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_APPLICATION_RETRIES) {
    try {
      const answer = await client.noul(
        { text: 'Hello, world' },
        noul('Is this a greeting?'),
      );
      console.log('Result:', answer.noul.toFixed(3));
      return;
    } catch (err) {
      if (err instanceof RateLimitError) {
        const waitMs = retryAfterMs(err) ?? 5_000;
        console.log(`Rate limited. Waiting ${waitMs}ms before retry ${attempt + 1}...`);
        await sleep(waitMs);
        attempt++;
        continue;
      }
      throw err; // re-throw anything else
    }
  }
  console.error('Exhausted application retries on rate limit.');
}

// ---- 2. Per-request timeout with AbortSignal ------------------------------
//
// Use AbortController to cancel a request that has been waiting too long in the
// context of a broader timeout (e.g. an HTTP request handler with a deadline).
// The client's built-in `timeoutMs` applies at the transport level; an
// AbortSignal is for cross-cutting cancellation (e.g. user navigated away).

async function callWithDeadline(client: TypeSafeClient): Promise<void> {
  const controller = new AbortController();
  // Cancel after 3 seconds regardless.
  const deadline = setTimeout(() => controller.abort(), 3_000);

  try {
    const answer = await client.noul(
      { text: 'Is this urgent?' },
      noul('Does this look time-sensitive?'),
      { signal: controller.signal },
    );
    console.log('Answer within deadline:', answer.noul.toFixed(3));
  } catch (err) {
    if (err instanceof AbortError) {
      console.log('Request cancelled by deadline controller.');
    } else if (err instanceof TimeoutError) {
      console.log('Request timed out at the transport level.');
    } else {
      throw err;
    }
  } finally {
    clearTimeout(deadline);
  }
}

// ---- 3. Distinguish authentication from other errors ----------------------

async function callWithBadKey(): Promise<void> {
  const badClient = new TypeSafeClient({ apiKey: 'ots_live_obviously_invalid_key' });

  try {
    await badClient.noul({ data: 'test' }, noul('Is this a test?'));
  } catch (err) {
    if (err instanceof AuthenticationError) {
      console.log('Auth error (expected): check TYPESAFE_API_KEY.');
      console.log('  status:', err.status);
      console.log('  requestId:', err.requestId ?? 'none');
    } else if (err instanceof TypeSafeError) {
      console.log('Other TypeSafe error:', err.constructor.name, err.message);
    } else {
      throw err;
    }
  }
}

// ---- 4. ValidationError: catch bad question definitions early -------------
//
// PrimitiveError is thrown synchronously by the builders (choice/score).
// ValidationError comes back from the server when the request is structurally bad.

async function demonstrateValidationError(client: TypeSafeClient): Promise<void> {
  try {
    // This will throw synchronously before any network call.
    const { choice } = await import('../src/primitives.js');
    choice('Pick one', []); // PrimitiveError: empty options
  } catch (err) {
    if (err instanceof Error) {
      console.log('Primitive validation (sync):', err.message);
    }
  }

  // Server-side ValidationError (malformed request structure):
  try {
    // Force a server error by sending an empty question map.
    await client.systemOne({
      state: {},
      questions: {} as Record<string, never>,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      console.log('Server validation error:', err.message);
    } else if (err instanceof TypeSafeError) {
      // Server may return a different error code depending on the implementation.
      console.log('TypeSafe error on empty questions:', err.constructor.name, err.message);
    }
  }
}

// ---- 5. Network error and retry budget exhaustion -------------------------
//
// The client retries transient failures automatically. When the budget is
// exhausted, a NetworkError or ConnectionError is thrown. A ConnectionError is
// always a network-level failure; a NetworkError is the base class.

async function demonstrateNetworkError(): Promise<void> {
  const brokenClient = new TypeSafeClient({
    apiKey: 'ots_live_test',
    baseURL: 'http://localhost:0', // nothing listening here
    maxRetries: 1, // keep the example fast
    timeoutMs: 500,
  });

  try {
    await brokenClient.noul({ test: true }, noul('Is this reachable?'));
  } catch (err) {
    if (err instanceof NetworkError) {
      console.log('Network error (expected on localhost:0):', err.constructor.name);
    } else {
      throw err;
    }
  }
}

// ---- Run all examples -----------------------------------------------------

const client = new TypeSafeClient({ maxRetries: 1 });

console.log('=== Rate limit handling ===');
await callWithRateLimitHandling(client).catch((e: unknown) =>
  console.log('Skipped (no real server):', e instanceof Error ? e.message : String(e)),
);
console.log();

console.log('=== Deadline / AbortSignal ===');
await callWithDeadline(client).catch((e: unknown) =>
  console.log('Skipped (no real server):', e instanceof Error ? e.message : String(e)),
);
console.log();

console.log('=== Bad API key ===');
await callWithBadKey();
console.log();

console.log('=== Validation error ===');
await demonstrateValidationError(client);
console.log();

console.log('=== Network error ===');
await demonstrateNetworkError();
console.log();

console.log('Done.');
