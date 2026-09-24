/**
 * Basic questions: noul, choice, and score.
 *
 * Shows all three question types evaluated against a short support-ticket string.
 * Typed answers are derived directly from the question definitions — no casting needed.
 *
 * Run with:
 *   OPENJEV_API_KEY=<key> npx tsx examples/01-basic-questions.ts
 */
import { choice, noul, OpenJevClient, score } from "../src";

const client = new OpenJevClient();

const ticket =
  "Hello, I was charged twice for my subscription this month. " +
  "My account is john@example.com. Please refund one charge immediately.";

const { answers, model, usage } = await client.systemOne({
  state: ticket,
  questions: {
    // noul: probability that the answer is "yes" (0 → no, 1 → yes)
    isBilling: noul("Is this ticket about a billing issue?"),

    // choice: pick one label; probabilities are typed to the exact label set
    department: choice("Which support department should handle this?", {
      billing: "Charge disputes and invoices",
      technical: "Product bugs and errors",
      account: "Account access and profile changes",
    }),

    // score: expected value on the rubric; legend mirrors the criteria array
    urgency: score("How urgently does this need a response?", [
      "can wait several days",
      "reply within 48 hours",
      "reply today",
      "reply within the hour",
    ]),
  },
});

// Each field is typed by its question — no type assertions required.
console.log("model    :", model);
console.log("tokens   :", usage.input_tokens, "in /", usage.output_tokens, "out");
console.log("");
console.log("billing? :", answers.isBilling.noul.toFixed(3));
console.log(
  "dept     :",
  answers.department.choice,
  `(confidence ${answers.department.confidence.toFixed(2)})`,
);
console.log(
  "urgency  :",
  answers.urgency.score.toFixed(2),
  "/",
  String(answers.urgency.legend[3]),
  `(confidence ${answers.urgency.confidence.toFixed(2)})`,
);
