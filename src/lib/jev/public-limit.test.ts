import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clientIp,
  hostedAnonymousLimitsEnabled,
  publicBatchSizeResponse,
  DEFAULT_PUBLIC_RPM_GLOBAL,
  DEFAULT_PUBLIC_RPM_PER_IP,
  planQuotaResponse,
  publicLimitConfigFromEnv,
  publicMaxBodyBytesFromEnv,
  publicRateLimitResponse,
  PublicRateLimiter,
  readJsonLimited,
  trustProxyHeaders,
} from "./public-limit.ts";

const cfg = (perIp: number, global: number) => ({
  perIpPerWindow: perIp,
  globalPerWindow: global,
  windowMs: 60_000,
});

describe("PublicRateLimiter", () => {
  it("admits up to the per-IP limit, then denies with retry-after", () => {
    const l = new PublicRateLimiter(cfg(3, 100));
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) assert.equal(l.check("1.1.1.1", t0 + i).allowed, true);
    const d = l.check("1.1.1.1", t0 + 10_000);
    assert.equal(d.allowed, false);
    if (d.allowed) return;
    assert.equal(d.scope, "ip");
    assert.equal(d.limit, 3);
    assert.equal(d.retryAfterSeconds, 50);
    // other IPs are unaffected
    assert.equal(l.check("2.2.2.2", t0 + 10_000).allowed, true);
  });

  it("resets after the window elapses", () => {
    const l = new PublicRateLimiter(cfg(1, 100));
    assert.equal(l.check("a", 0).allowed, true);
    assert.equal(l.check("a", 59_999).allowed, false);
    assert.equal(l.check("a", 60_000).allowed, true);
  });

  it("enforces the global window across IPs", () => {
    const l = new PublicRateLimiter(cfg(10, 2));
    assert.equal(l.check("a", 0).allowed, true);
    assert.equal(l.check("b", 1).allowed, true);
    const d = l.check("c", 2);
    assert.equal(d.allowed, false);
    if (!d.allowed) assert.equal(d.scope, "global");
  });

  it("an IP-denied request does not consume global budget", () => {
    const l = new PublicRateLimiter(cfg(1, 3));
    l.check("a", 0);
    for (let i = 0; i < 5; i++) assert.equal(l.check("a", 1).allowed, false);
    assert.equal(l.check("b", 2).allowed, true);
    assert.equal(l.check("c", 3).allowed, true);
    assert.equal(l.check("d", 4).allowed, false);
  });

  it("limit 0 disables a window", () => {
    const l = new PublicRateLimiter(cfg(0, 0));
    for (let i = 0; i < 1000; i++) assert.equal(l.check("a", i).allowed, true);
  });

  it("reports remaining on admitted calls", () => {
    const l = new PublicRateLimiter(cfg(5, 100));
    const d = l.check("a", 0);
    assert.equal(d.allowed, true);
    assert.equal(d.remaining, 4);
  });
});

describe("trustProxyHeaders", () => {
  it("is untrusted by default (no OPENJEV_HOSTED / OPENJEV_TRUST_PROXY_HEADERS)", () => {
    assert.equal(trustProxyHeaders({}), false);
  });

  it("is trusted when hosted", () => {
    assert.equal(trustProxyHeaders({ OPENJEV_HOSTED: "1" }), true);
  });

  it("is trusted when a self-hoster opts in explicitly", () => {
    assert.equal(trustProxyHeaders({ OPENJEV_TRUST_PROXY_HEADERS: "1" }), true);
    assert.equal(trustProxyHeaders({ OPENJEV_TRUST_PROXY_HEADERS: "true" }), true);
    assert.equal(trustProxyHeaders({ OPENJEV_TRUST_PROXY_HEADERS: "0" }), false);
  });
});

describe("clientIp", () => {
  const trusted = { OPENJEV_TRUST_PROXY_HEADERS: "1" };

  it("ignores forwarded-IP headers by default, even when present (spoofable without a trusted proxy)", () => {
    assert.equal(clientIp(new Headers({ "cf-connecting-ip": "9.9.9.9" }), {}), "unknown");
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" }), {}), "unknown");
  });

  it("prefers cf-connecting-ip, then x-real-ip, once trusted", () => {
    assert.equal(
      clientIp(new Headers({ "cf-connecting-ip": "9.9.9.9", "x-real-ip": "8.8.8.8" }), trusted),
      "9.9.9.9",
    );
    assert.equal(
      clientIp(new Headers({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" }), trusted),
      "8.8.8.8",
    );
  });

  it("takes the rightmost X-Forwarded-For hop (client can't spoof it), once trusted", () => {
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" }), trusted), "7.7.7.7");
  });

  it("falls back to unknown", () => {
    assert.equal(clientIp(new Headers(), trusted), "unknown");
  });
});

describe("config from env", () => {
  it("uses defaults for missing / invalid values", () => {
    const c = publicLimitConfigFromEnv({ OPENJEV_PUBLIC_RPM_PER_IP: "abc" });
    assert.equal(c.perIpPerWindow, DEFAULT_PUBLIC_RPM_PER_IP);
    assert.equal(c.globalPerWindow, DEFAULT_PUBLIC_RPM_GLOBAL);
  });

  it("accepts explicit integers including 0", () => {
    const c = publicLimitConfigFromEnv({ OPENJEV_PUBLIC_RPM_PER_IP: "0", OPENJEV_PUBLIC_RPM_GLOBAL: "50" });
    assert.equal(c.perIpPerWindow, 0);
    assert.equal(c.globalPerWindow, 50);
  });

  it("body cap: env override wins, else the route fallback", () => {
    assert.equal(publicMaxBodyBytesFromEnv(1000, {}), 1000);
    assert.equal(publicMaxBodyBytesFromEnv(1000, { OPENJEV_PUBLIC_MAX_BODY_BYTES: "2048" }), 2048);
  });
});

describe("429 responses", () => {
  it("public denial carries Retry-After and a clear JSON body", async () => {
    const l = new PublicRateLimiter(cfg(1, 100));
    l.check("a", 0);
    const d = l.check("a", 30_000);
    assert.equal(d.allowed, false);
    if (d.allowed) return;
    const res = publicRateLimitResponse(d, 30_000);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "30");
    assert.equal(res.headers.get("RateLimit-Limit"), "1");
    const body = (await res.json()) as { error: Record<string, unknown> };
    assert.equal(body.error.type, "rate_limit");
    assert.equal(body.error.reason, "ip_rate_limit");
    assert.equal(body.error.retry_after_seconds, 30);
    assert.equal(body.error.window_seconds, 60);
    assert.match(String(body.error.message), /30s/);
  });

  it("plan quota denial derives Retry-After from reset_at", async () => {
    const now = Date.parse("2026-09-24T12:00:00.000Z");
    const res = planQuotaResponse(
      { message: "m", reason: "rate_limit", used: 60, limit: 60, reset_at: "2026-09-24T12:00:45.000Z" },
      now,
    );
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "45");
    const body = (await res.json()) as { error: Record<string, unknown> };
    assert.equal(body.error.reason, "rate_limit");
    assert.equal(body.error.limit, 60);
  });
});

describe("readJsonLimited", () => {
  const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request("http://x/api", { method: "POST", body, headers, duplex: "half" } as RequestInit);

  it("parses a body under the cap", async () => {
    const r = await readJsonLimited(post('{"a":1}'), 100);
    assert.deepEqual(r, { ok: true, value: { a: 1 } });
  });

  it("413s on a declared Content-Length over the cap", async () => {
    const r = await readJsonLimited(post("{}", { "content-length": "5000" }), 100);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.response.status, 413);
  });

  it("413s on a streamed body over the cap without Content-Length", async () => {
    const big = "x".repeat(500);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(`{"a":"${big}`));
        c.enqueue(new TextEncoder().encode(`${big}"}`));
        c.close();
      },
    });
    const r = await readJsonLimited(post(stream), 600);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.response.status, 413);
      const body = (await r.response.json()) as { error: { type: string; limit_bytes: number } };
      assert.equal(body.error.type, "payload_too_large");
      assert.equal(body.error.limit_bytes, 600);
    }
  });

  it("strict mode 400s on bad JSON; lenient mode yields {}", async () => {
    const strict = await readJsonLimited(post("{nope"), 100);
    assert.equal(strict.ok, false);
    if (!strict.ok) assert.equal(strict.response.status, 400);
    assert.deepEqual(await readJsonLimited(post("{nope"), 100, { lenient: true }), { ok: true, value: {} });
    assert.deepEqual(await readJsonLimited(post(null), 100, { lenient: true }), { ok: true, value: {} });
  });
});

describe("hosted anonymous System One limits", () => {
  it("are off for self-host by default and on only for OPENJEV_HOSTED=1/true", () => {
    assert.equal(hostedAnonymousLimitsEnabled({}), false);
    assert.equal(hostedAnonymousLimitsEnabled({ OPENJEV_HOSTED: "" }), false);
    assert.equal(hostedAnonymousLimitsEnabled({ OPENJEV_HOSTED: "0" }), false);
    assert.equal(hostedAnonymousLimitsEnabled({ OPENJEV_HOSTED: "1" }), true);
    assert.equal(hostedAnonymousLimitsEnabled({ OPENJEV_HOSTED: "TRUE" }), true);
  });

  it("charges a batch one unit per item against the same windows", () => {
    const l = new PublicRateLimiter(cfg(30, 600));
    assert.equal(l.check("9.9.9.9", 0, 20).allowed, true);
    const d = l.check("9.9.9.9", 1, 20);
    assert.equal(d.allowed, false);
    assert.equal(l.check("9.9.9.9", 2, 10).allowed, true);
  });

  it("refuses a batch larger than the per-IP window with a 400, not a 429", async () => {
    assert.equal(publicBatchSizeResponse(30, cfg(30, 600)), null);
    assert.equal(publicBatchSizeResponse(32, cfg(0, 600)), null);
    const res = publicBatchSizeResponse(31, cfg(30, 600));
    assert.ok(res);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { reason: string; limit: number; received: number } };
    assert.equal(body.error.reason, "public_batch_limit");
    assert.equal(body.error.limit, 30);
    assert.equal(body.error.received, 31);
  });
});
