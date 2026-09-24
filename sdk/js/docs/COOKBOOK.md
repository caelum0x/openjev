# @openjev/sdk Cookbook

Runnable examples for common patterns. Each file in `examples/` is a
self-contained TypeScript script. Run any of them with:

```sh
OPENJEV_API_KEY=<your-key> npx tsx examples/<file>.ts
```

---

## Examples

### [01-basic-questions.ts](../examples/01-basic-questions.ts)

**All three question types — `noul`, `choice`, and `score`.**

Evaluates a support ticket string and shows how TypeScript infers the answer
type from each question definition. No casting required; accessing a wrong
field is a compile error.

Key patterns:

- `noul(instructions)` — probability the answer is "yes" (`0` to `1`)
- `choice(instructions, { label: description, … })` — picks one label;
  `answers.field.choice` is typed to the exact label union
- `score(instructions, [criteria0, criteria1, …])` — expected value on the
  rubric; `answers.field.legend` mirrors the criteria array

---

### [02-batch.ts](../examples/02-batch.ts)

**Fan out multiple `systemOne` calls in parallel with `Promise.all`.**

The SDK has no dedicated batch endpoint. `Promise.all` is the recommended
pattern: each call gets an independent retry budget and request ID so failures
are easy to isolate. Token totals are aggregated afterwards.

Key patterns:

- `Promise.all(items.map(item => client.systemOne(…)))` for parallel calls
- `.then(r => ({ index, …r }))` to correlate results with the source items
- Accumulate `usage.input_tokens` / `usage.output_tokens` for cost tracking

---

### [03-inspect-response.ts](../examples/03-inspect-response.ts)

**Access the HTTP response alongside the parsed result.**

`APIPromise` exposes two opt-in accessors:

| Method | Returns | Use when |
|---|---|---|
| `withResponse()` | `{ data, response, requestId }` | You need the request ID, status, or headers alongside the typed answer |
| `asResponse()` | raw `Response` | You want to forward the stream or skip JSON parsing entirely |

Both work on any `APIPromise` — `systemOne`, `models.list`, or custom resources.

---

### [04-error-handling.ts](../examples/04-error-handling.ts)

**Typed errors, custom retry policy, and AbortSignal cancellation.**

Error hierarchy:

```
OpenJevError
├── APIError                    (non-2xx HTTP responses)
│   ├── BadRequestError         400
│   ├── AuthenticationError     401
│   ├── PermissionDeniedError   403
│   ├── NotFoundError           404
│   ├── UnprocessableEntityError 422
│   ├── RateLimitError          429  (+ .retryAfterMs)
│   └── InternalServerError     5xx
├── APIConnectionError          (DNS, TLS, dropped connection)
│   └── APITimeoutError         (+ .timeoutMs)
└── APIUserAbortError           (AbortSignal fired)
```

Key patterns:

- `instanceof` checks from most-specific to least-specific
- Per-client retry override: `new OpenJevClient({ retry: { maxRetries: 5 } })`
- Per-call override: `client.systemOne(…, { retry: { maxRetries: 0 }, timeout: 3_000 })`
- Cancellation: pass `{ signal: controller.signal }` and call `controller.abort()`

---

### [05-framework-integration.ts](../examples/05-framework-integration.ts)

**Reusable analysis helper wired into a Node.js HTTP server.**

Demonstrates the recommended integration pattern for any server-side HTTP
framework (Next.js Route Handlers, Express, Hono, Fastify, etc.):

1. **Construct the client once** at module scope — share retries, headers, and
   the underlying `fetch` pool across all requests.
2. **Wrap `systemOne` in a typed domain function** (`analyze(input)`) to
   decouple the API surface from the question definitions.
3. **Catch and map errors** to HTTP status codes so callers get useful
   responses instead of 500s.

The server in the example uses only `node:http` to avoid extra dependencies;
drop the `analyze()` function into any async route handler.

---

## Next steps

- See the full type reference: run `npm run docs` from the repository root.
- Combine with an `AbortController` and `Promise.race` to impose a wall-clock
  deadline across a batch of calls.
- Pass a custom `fetch` to `OpenJevClient` to route requests through a proxy,
  add telemetry, or swap in a mock for testing.
