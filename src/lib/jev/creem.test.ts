import assert from "node:assert/strict";
import { test } from "node:test";
import { creemSignature, parseCreemEvent, planForProduct, verifyCreemSignature } from "./creem.ts";

const secret = "whsec_test_secret";
const body = JSON.stringify({
  id: "evt_1",
  eventType: "checkout.completed",
  object: {
    id: "ch_1",
    object: "checkout",
    request_id: "user_42",
    product: { id: "prod_cal" },
    customer: { id: "cust_1", email: "Owner@Example.com" },
    subscription: { id: "sub_1" },
    metadata: {},
  },
});

test("signature verifies only for the exact body and secret", () => {
  const sig = creemSignature(body, secret);
  assert.equal(verifyCreemSignature(body, sig, secret), true);
  assert.equal(verifyCreemSignature(body + " ", sig, secret), false);
  assert.equal(verifyCreemSignature(body, sig, "other"), false);
  assert.equal(verifyCreemSignature(body, null, secret), false);
  assert.equal(verifyCreemSignature(body, "not-hex", secret), false);
});

test("checkout event parses product, customer and user", () => {
  const e = parseCreemEvent(JSON.parse(body));
  assert.deepEqual(e, {
    id: "evt_1",
    type: "checkout.completed",
    productId: "prod_cal",
    customerEmail: "owner@example.com",
    userId: "user_42",
    subscriptionId: "sub_1",
  });
});

test("subscription event parses its own id and string product", () => {
  const e = parseCreemEvent({
    id: "evt_2",
    eventType: "subscription.expired",
    object: { id: "sub_9", object: "subscription", product: "prod_team", customer: { email: "a@b.co" }, metadata: { user_id: "u1" } },
  });
  assert.equal(e.subscriptionId, "sub_9");
  assert.equal(e.productId, "prod_team");
  assert.equal(e.userId, "u1");
});

test("malformed envelopes throw; plan comes only from configured product ids", () => {
  assert.throws(() => parseCreemEvent({ object: {} }));
  const env = { CREEM_PRODUCT_ID_CALIBRATE: "prod_cal", CREEM_PRODUCT_ID_TEAM: "prod_team" };
  assert.equal(planForProduct("prod_cal", env)?.id, "calibrate");
  assert.equal(planForProduct("prod_team", env)?.id, "team");
  assert.equal(planForProduct("prod_other", env), null);
  assert.equal(planForProduct("prod_cal", {}), null);
});
