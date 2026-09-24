import type { GoldCase } from "./types.ts";
import { DEPARTMENT, IS_REFUND, SEVERITY } from "./schemas.ts";

/**
 * Structured-vs-string state: the state is an object or array rather than a
 * plain string. The engine flattens these to prose (field names become words),
 * so these cases verify that structured inputs classify as well as their string
 * equivalents and that field labels participate in matching.
 */
export const STRUCTURED: GoldCase[] = [
  {
    id: "struct-ticket-object",
    source: "structured: ticket object with metadata",
    features: ["structured"],
    state: {
      subject: "Duplicate charge on my card",
      body: "I was billed twice for order 8841 and want the extra charge reversed.",
      customer_tier: "gold",
    },
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "billing", minP: 0.35 } }],
  },
  {
    id: "struct-nested-order",
    source: "structured: nested order object",
    features: ["structured"],
    state: {
      order: {
        id: "A-2201",
        item: "trail running shoes",
        issue: "arrived in the wrong size, need a bigger pair",
      },
      requested_action: "exchange",
    },
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "returns", minP: 0.35 } }],
  },
  {
    id: "struct-array-conversation",
    source: "structured: array of conversation turns",
    features: ["structured"],
    state: [
      "Customer: my login stopped working after the update.",
      "Agent: have you tried resetting your password?",
      "Customer: yes, twice, it still says my account is locked.",
    ],
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "account", minP: 0.3 } }],
  },
  {
    id: "struct-refund-flag",
    source: "structured: explicit refund field",
    features: ["structured"],
    state: {
      message: "The flight was cancelled by the airline.",
      customer_request: "full refund to original payment method",
    },
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", min: 0.55 } }],
  },
  {
    id: "struct-incident-object",
    source: "structured: incident object severity",
    features: ["structured"],
    state: {
      component: "authentication",
      symptom: "all users receive a 500 error on login",
      impact: "nobody can access the product; the service is completely down",
    },
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 1.1, max: 2 } }],
  },
  {
    id: "struct-incident-cosmetic",
    source: "structured: cosmetic incident object",
    features: ["structured"],
    state: {
      component: "settings page",
      symptom: "the save icon is misaligned by a few pixels",
      impact: "purely visual, everything still works",
      workaround: "not needed",
    },
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 0, max: 0.7 } }],
  },
  {
    id: "struct-with-policy-context",
    source: "structured: message plus policy context field",
    features: ["structured"],
    state: {
      ticket_message: "My order never showed up and it's been two weeks.",
      shipping_policy: "Lost packages are investigated by the delivery team.",
    },
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "shipping", minP: 0.35 } }],
  },
  {
    id: "struct-mixed-array",
    source: "structured: mixed array of tags and text",
    features: ["structured"],
    state: [
      "priority: high",
      "The API integration is throwing exceptions and our checkout is down.",
      "affected_users: many",
    ],
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 1, max: 2 } }],
  },
  {
    id: "struct-sales-object",
    source: "structured: pre-sales inquiry object",
    features: ["structured"],
    state: {
      company_size: 120,
      interest: "enterprise plan pricing and a product demo",
      timeline: "evaluating this quarter",
    },
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "sales", minP: 0.35 } }],
  },
  {
    id: "struct-no-refund-field",
    source: "structured: object that does not request refund",
    features: ["structured", "negation"],
    state: {
      message: "Just confirming my subscription renewed successfully.",
      customer_request: "none, informational only",
    },
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", max: 0.5 } }],
  },
];
