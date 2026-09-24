import assert from "node:assert/strict";
import { test } from "node:test";
import { evalGold } from "./gold.ts";
import { runLocal } from "./engine.ts";
import { validateRequest } from "./validate.ts";

test("system-one hits TypeSafe gold cases", () => {
  const { passed, failed, hits } = evalGold("system-one");
  const misses = hits.filter((h) => !h.ok);
  assert.equal(
    failed,
    0,
    misses.map((m) => `${m.id} → ${m.detail}`).join("\n"),
  );
  assert.ok(passed >= 12);
});

test("structured instructions and criteria are accepted", () => {
  const req = validateRequest({
    state: { ticket: { messages: [{ text: "refund please" }] } },
    questions: {
      refund: {
        type: "noul",
        instructions: {
          question: "Does `ticket.messages[0].text` request a refund?",
          focus: "Look at the latest customer message.",
        },
        criteria: {
          true: { what: "Asks for money back", examples: ["refund please"] },
          false: { what: "No refund language" },
        },
      },
    },
  });
  const out = runLocal(req, "system-one");
  const a = out.answers.refund;
  assert.equal(a?.type, "noul");
  if (a?.type === "noul") assert.ok(a.noul > 0.5);
});

test("choice is capped at 255 options", () => {
  const criteria: Record<string, string> = {};
  for (let i = 0; i < 256; i++) criteria[`o${i}`] = "x";
  assert.throws(() =>
    validateRequest({
      state: "x",
      questions: {
        q: { type: "choice", instructions: "pick", criteria },
      },
    }),
  );
});
