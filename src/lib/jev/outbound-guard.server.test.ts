import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidOutboundUrl } from "./outbound-guard.server.ts";

// Only the synchronous, network-free surface is tested here (no real DNS
// lookups) — `assertPublicAddress`/`assertSafeOutboundUrl` additionally
// resolve hostnames and are exercised indirectly by
// benchmark-submissions.server.ts at request time.

test("isValidOutboundUrl: accepts ordinary public http(s) URLs", () => {
  assert.equal(isValidOutboundUrl("https://example.com/predict"), true);
  assert.equal(isValidOutboundUrl("http://api.example.com:8080/x"), true);
});

test("isValidOutboundUrl: rejects non-http(s) schemes", () => {
  assert.equal(isValidOutboundUrl("file:///etc/passwd"), false);
  assert.equal(isValidOutboundUrl("ftp://example.com/x"), false);
  assert.equal(isValidOutboundUrl("gopher://example.com/x"), false);
});

test("isValidOutboundUrl: rejects localhost and loopback literals", () => {
  assert.equal(isValidOutboundUrl("http://localhost/predict"), false);
  assert.equal(isValidOutboundUrl("http://sub.localhost/predict"), false);
  assert.equal(isValidOutboundUrl("http://127.0.0.1/predict"), false);
  assert.equal(isValidOutboundUrl("http://[::1]/predict"), false);
});

test("isValidOutboundUrl: rejects RFC1918 private + link-local + metadata IPs", () => {
  assert.equal(isValidOutboundUrl("http://10.0.0.5/x"), false);
  assert.equal(isValidOutboundUrl("http://172.16.0.5/x"), false);
  assert.equal(isValidOutboundUrl("http://192.168.1.5/x"), false);
  assert.equal(isValidOutboundUrl("http://169.254.169.254/latest/meta-data"), false); // cloud metadata
  assert.equal(isValidOutboundUrl("http://100.64.0.1/x"), false); // CGNAT
});

test("isValidOutboundUrl: rejects malformed URLs rather than throwing", () => {
  assert.equal(isValidOutboundUrl("not a url"), false);
  assert.equal(isValidOutboundUrl(""), false);
});
