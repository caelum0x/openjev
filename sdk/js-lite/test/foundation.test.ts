import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveConfig,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  type ResolvedConfig,
} from '../src/config.ts';
import {
  errorFromResponse,
  APIError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  TimeoutError,
  ConnectionError,
  AbortError,
  NetworkError,
  OpenJevError,
  TypeSafeError,
  retryAfterMs,
} from '../src/errors.ts';
import { createLogger, parseLogLevel, redactHeaders, silentLogger } from '../src/logging.ts';
import { HttpClient } from '../src/http.ts';

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('resolveConfig: explicit options win and defaults fill', () => {
  const cfg = resolveConfig({ apiKey: 'ots_live_abc' }, () => {});
  assert.equal(cfg.apiKey, 'ots_live_abc');
  assert.equal(cfg.baseURL, DEFAULT_BASE_URL);
  assert.equal(cfg.model, DEFAULT_MODEL);
  assert.equal(cfg.logLevel, 'off');
});

test('resolveConfig: OPENJEV_* primary, TYPESAFE_* back-compat alias', () => {
  withEnv(
    {
      OPENJEV_API_KEY: 'ots_test_primary',
      TYPESAFE_API_KEY: undefined,
      OPENJEV_BASE_URL: 'https://self.host/api/',
      TYPESAFE_BASE_URL: undefined,
      OPENJEV_MODEL: 'otsone-primary',
      TYPESAFE_MODEL: 'ots-alias',
    },
    () => {
      const cfg = resolveConfig({}, () => {});
      assert.equal(cfg.apiKey, 'ots_test_primary');
      // trailing slash normalized away
      assert.equal(cfg.baseURL, 'https://self.host/api');
      // primary (OPENJEV_*) wins over alias (TYPESAFE_*)
      assert.equal(cfg.model, 'otsone-primary');
    },
  );
});

test('resolveConfig: TYPESAFE_* alias resolves when OPENJEV_* absent', () => {
  withEnv(
    {
      OPENJEV_API_KEY: undefined,
      TYPESAFE_API_KEY: 'ots_test_alias',
      OPENJEV_BASE_URL: undefined,
      TYPESAFE_BASE_URL: 'https://alias.host/',
      OPENJEV_MODEL: undefined,
      TYPESAFE_MODEL: 'ots-alias-model',
    },
    () => {
      const cfg = resolveConfig({}, () => {});
      assert.equal(cfg.apiKey, 'ots_test_alias');
      assert.equal(cfg.baseURL, 'https://alias.host');
      assert.equal(cfg.model, 'ots-alias-model');
    },
  );
});

test('resolveConfig: missing key throws OpenJevError', () => {
  withEnv(
    { OPENJEV_API_KEY: undefined, TYPESAFE_API_KEY: undefined, typesafe_api_key: undefined },
    () => {
      assert.throws(() => resolveConfig({}, () => {}), OpenJevError);
    },
  );
});

test('resolveConfig: unknown prefix warns, does not throw', () => {
  let warned = '';
  const cfg = resolveConfig({ apiKey: 'sk-legacy-key' }, (m) => {
    warned = m;
  });
  assert.equal(cfg.apiKey, 'sk-legacy-key');
  assert.match(warned, /known prefix/);
});

test('resolveConfig: malformed baseURL throws', () => {
  assert.throws(() => resolveConfig({ apiKey: 'ots_live_x', baseURL: 'not a url' }, () => {}), TypeSafeError);
});

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

test('errorFromResponse maps status codes to subclasses', () => {
  const h = new Headers();
  assert.ok(errorFromResponse(400, { error: { message: 'bad' } }, h) instanceof ValidationError);
  assert.ok(errorFromResponse(401, {}, h) instanceof AuthenticationError);
  assert.ok(errorFromResponse(403, {}, h) instanceof PermissionError);
  assert.ok(errorFromResponse(404, {}, h) instanceof NotFoundError);
  assert.ok(errorFromResponse(429, {}, h) instanceof RateLimitError);
  const server = errorFromResponse(503, {}, h);
  assert.ok(server instanceof APIError);
  assert.equal(server.status, 503);
});

test('APIError carries status, requestId, body, and error type', () => {
  const headers = new Headers({ 'x-openjev-request-id': 'req_123' });
  const err = errorFromResponse(401, { error: { type: 'auth_error', message: 'no key' } }, headers);
  assert.equal(err.status, 401);
  assert.equal(err.requestId, 'req_123');
  assert.equal(err.errorType, 'auth_error');
  assert.match(err.message, /no key/);
});

test('ValidationError extracts field details', () => {
  const body = {
    error: {
      message: 'invalid',
      details: [
        { field: 'questions.q1', message: 'unknown type' },
        { loc: ['body', 'state'], msg: 'required' },
      ],
    },
  };
  const err = errorFromResponse(400, body, new Headers());
  assert.ok(err instanceof ValidationError);
  assert.equal(err.fields.length, 2);
  assert.equal(err.fields[0]?.field, 'questions.q1');
  assert.equal(err.fields[1]?.field, 'state');
  assert.equal(err.fields[1]?.message, 'required');
});

test('RateLimitError parses Retry-After and reset', () => {
  const reset = Math.floor(Date.now() / 1000) + 60;
  const headers = new Headers({ 'retry-after': '30', 'x-ratelimit-reset': String(reset) });
  const err = errorFromResponse(429, {}, headers) as RateLimitError;
  assert.equal(err.retryAfter, 30_000);
  assert.ok(err.reset instanceof Date);
  assert.equal(Math.round(err.reset.getTime() / 1000), reset);
});

test('retryAfterMs handles seconds and http-date', () => {
  assert.equal(retryAfterMs(new Headers({ 'retry-after': '5' })), 5000);
  const future = new Date(Date.now() + 10_000).toUTCString();
  const ms = retryAfterMs(new Headers({ 'retry-after': future }));
  assert.ok(ms !== undefined && ms > 8000 && ms <= 10_000);
  assert.equal(retryAfterMs(new Headers()), undefined);
});

test('NetworkError is an alias for ConnectionError', () => {
  const e = new NetworkError('down');
  assert.ok(e instanceof ConnectionError);
  assert.equal(e.name, 'ConnectionError');
});

// ---------------------------------------------------------------------------
// logging
// ---------------------------------------------------------------------------

test('createLogger filters below the configured level', () => {
  const seen: string[] = [];
  const sink = {
    debug: (m: string) => seen.push(`debug:${m}`),
    info: (m: string) => seen.push(`info:${m}`),
    warn: (m: string) => seen.push(`warn:${m}`),
    error: (m: string) => seen.push(`error:${m}`),
  };
  const log = createLogger('warn', sink);
  log.debug('d');
  log.info('i');
  log.warn('w');
  log.error('e');
  assert.deepEqual(seen, ['warn:w', 'error:e']);
});

test('createLogger off returns the silent logger', () => {
  assert.equal(createLogger('off'), silentLogger);
});

test('parseLogLevel normalizes and rejects unknowns', () => {
  assert.equal(parseLogLevel('DEBUG'), 'debug');
  assert.equal(parseLogLevel(' warn '), 'warn');
  assert.equal(parseLogLevel('loud'), undefined);
  assert.equal(parseLogLevel(undefined), undefined);
});

test('redactHeaders masks credentials, keeps the rest', () => {
  const out = redactHeaders({
    Authorization: 'Bearer ots_live_supersecretkey',
    'X-Request-Id': 'req_1',
    cookie: 'session=abc',
  });
  assert.equal(out['X-Request-Id'], 'req_1');
  assert.equal(out.cookie, '***');
  assert.match(out.Authorization ?? '', /^Bearer \*\*\*/);
  assert.doesNotMatch(out.Authorization ?? '', /supersecret/);
});

// ---------------------------------------------------------------------------
// http transport
// ---------------------------------------------------------------------------

const CONFIG: ResolvedConfig = {
  apiKey: 'ots_live_testkey',
  baseURL: 'http://localhost:8080',
  model: 'otsone-latest',
  logLevel: 'off',
};

const OK_BODY = {
  model: 'otsone-latest',
  answers: { q: { type: 'noul', noul: 0.9 } },
  usage: { input_tokens: 12, output_tokens: 3 },
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('request returns parsed data plus meta (status, requestId, usage)', async () => {
  let capturedInit: RequestInit | undefined;
  let capturedUrl: string | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, OK_BODY, { 'x-openjev-request-id': 'req_server' });
  }) as unknown as typeof fetch;

  const client = new HttpClient({ config: CONFIG, fetch: fetchImpl });
  const result = await client.request<typeof OK_BODY>('/v1/systemone', { state: 'x' });

  assert.equal(capturedUrl, 'http://localhost:8080/v1/systemone');
  assert.equal(result.data.model, 'otsone-latest');
  assert.equal(result.meta.status, 200);
  assert.equal(result.meta.requestId, 'req_server');
  assert.deepEqual(result.meta.usage, { input_tokens: 12, output_tokens: 3 });

  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get('authorization'), 'Bearer ots_live_testkey');
  assert.match(headers.get('user-agent') ?? '', /^openjev-client\//);
  assert.ok((headers.get('x-request-id') ?? '').length > 0);
});

test('request retries on 429 then succeeds', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return jsonResponse(429, { error: { message: 'slow down' } });
    return jsonResponse(200, OK_BODY);
  }) as unknown as typeof fetch;

  const client = new HttpClient({
    config: CONFIG,
    fetch: fetchImpl,
    sleep: async () => {},
    random: () => 0,
  });
  const result = await client.request<typeof OK_BODY>('/v1/systemone', {});
  assert.equal(calls, 2);
  assert.equal(result.meta.status, 200);
});

test('request throws AuthenticationError on 401 without retrying', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse(401, { error: { message: 'bad key' } });
  }) as unknown as typeof fetch;

  const client = new HttpClient({ config: CONFIG, fetch: fetchImpl, sleep: async () => {} });
  await assert.rejects(
    () => client.request('/v1/systemone', {}),
    (e: unknown) => e instanceof AuthenticationError && e.status === 401,
  );
  assert.equal(calls, 1);
});

test('request retries network errors then gives up as ConnectionError', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;

  const client = new HttpClient({
    config: CONFIG,
    fetch: fetchImpl,
    maxRetries: 2,
    sleep: async () => {},
    random: () => 0,
  });
  await assert.rejects(
    () => client.request('/v1/systemone', {}),
    (e: unknown) => e instanceof ConnectionError,
  );
  assert.equal(calls, 3);
});

test('request maps a timeout to TimeoutError', async () => {
  const fetchImpl = (async (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    })) as unknown as typeof fetch;

  const client = new HttpClient({
    config: CONFIG,
    fetch: fetchImpl,
    timeoutMs: 5,
    maxRetries: 0,
    sleep: async () => {},
  });
  await assert.rejects(
    () => client.request('/v1/systemone', {}),
    (e: unknown) => e instanceof TimeoutError,
  );
});

test('request maps a caller abort to AbortError, not retried', async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls += 1;
    // Abort from the caller after this turn so the transport's own listener is attached.
    setTimeout(() => controller.abort(), 0);
    return new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
      signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
        once: true,
      });
    });
  }) as unknown as typeof fetch;

  const client = new HttpClient({ config: CONFIG, fetch: fetchImpl, sleep: async () => {} });
  await assert.rejects(
    () => client.request('/v1/systemone', {}, { signal: controller.signal }),
    (e: unknown) => e instanceof AbortError,
  );
  assert.equal(calls, 1);
});
