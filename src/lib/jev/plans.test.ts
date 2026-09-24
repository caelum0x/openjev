import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PRICE_PER_1K_DECISIONS_USD,
  planForQuota,
  pricePer1kDecisionsUsd,
  pricePerCallCents,
} from "./plans.ts";

const JEV_PER_1K_USD = 0.01;

test("default overage price is well under Jev's per-1k price", () => {
  delete process.env.OTS_PRICE_PER_1K_DECISIONS_USD;
  assert.ok(DEFAULT_PRICE_PER_1K_DECISIONS_USD < JEV_PER_1K_USD);
  assert.equal(pricePer1kDecisionsUsd(), DEFAULT_PRICE_PER_1K_DECISIONS_USD);
  // $0.002 per 1k decisions == 0.0002 cents per decision.
  assert.ok(Math.abs(pricePerCallCents() - 0.0002) < 1e-12);
});

test("price is configurable and rejects nonsense", () => {
  process.env.OTS_PRICE_PER_1K_DECISIONS_USD = "0";
  assert.equal(pricePer1kDecisionsUsd(), 0);
  process.env.OTS_PRICE_PER_1K_DECISIONS_USD = "0.005";
  assert.equal(pricePer1kDecisionsUsd(), 0.005);
  process.env.OTS_PRICE_PER_1K_DECISIONS_USD = "200"; // a cents/USD mix-up
  assert.equal(pricePer1kDecisionsUsd(), DEFAULT_PRICE_PER_1K_DECISIONS_USD);
  process.env.OTS_PRICE_PER_1K_DECISIONS_USD = "abc";
  assert.equal(pricePer1kDecisionsUsd(), DEFAULT_PRICE_PER_1K_DECISIONS_USD);
  delete process.env.OTS_PRICE_PER_1K_DECISIONS_USD;
});

test("plans are inferred from the account quota", () => {
  assert.equal(planForQuota(0).id, "selfhost");
  assert.equal(planForQuota(10_000).id, "free");
  assert.equal(planForQuota(250_000).id, "calibrate");
  assert.equal(planForQuota(5_000_000).id, "team");
  assert.equal(planForQuota(1_000).id, "free");
});

test("audit reports are a Team feature on hosted, and free on self-host", async () => {
  const { planAllows, planById } = await import("./plans.ts");
  const prev = process.env.OPENJEV_HOSTED;
  try {
    delete process.env.OPENJEV_HOSTED;
    assert.equal(planAllows(planById("free")!, "audit_reports"), true);
    process.env.OPENJEV_HOSTED = "1";
    assert.equal(planAllows(planById("free")!, "audit_reports"), false);
    assert.equal(planAllows(planById("calibrate")!, "audit_reports"), false);
    assert.equal(planAllows(planById("team")!, "audit_reports"), true);
    assert.equal(planAllows(planById("selfhost")!, "audit_reports"), true);
    process.env.OPENJEV_HOSTED = "true";
    assert.equal(planAllows(planById("free")!, "audit_reports"), false);
  } finally {
    if (prev === undefined) delete process.env.OPENJEV_HOSTED;
    else process.env.OPENJEV_HOSTED = prev;
  }
});
