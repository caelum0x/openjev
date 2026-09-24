/**
 * Batch processing: evaluate many items in parallel.
 *
 * The SDK has no dedicated batch endpoint; use Promise.all (or a concurrency
 * limiter) to fan out multiple systemOne calls. Each call gets its own retry
 * budget and request ID, making failures easy to isolate.
 *
 * Run with:
 *   OPENJEV_API_KEY=<key> npx tsx examples/02-batch.ts
 */
import { noul, OpenJevClient, score } from "../src";

const client = new OpenJevClient();

const reviews = [
  "Absolutely love this product. Fast shipping and great quality!",
  "Item arrived damaged. Very disappointed, will not order again.",
  "It's okay, does the job but nothing special.",
  "Worst purchase I've ever made. Complete waste of money.",
  "Exceeded my expectations in every way. Five stars!",
];

// Fan out all requests in parallel; each gets independent retries.
const results = await Promise.all(
  reviews.map((text, i) =>
    client
      .systemOne({
        state: text,
        questions: {
          positive: noul("Is this review positive overall?"),
          severity: score("How strongly does this review feel?", [
            "neutral / mild",
            "moderate",
            "strong / intense",
          ]),
        },
      })
      .then((r) => ({ index: i, text, ...r })),
  ),
);

console.log("Results\n-------");
for (const r of results) {
  const label = r.answers.positive.noul >= 0.5 ? "POSITIVE" : "NEGATIVE";
  console.log(
    `[${r.index}] ${label}  noul=${r.answers.positive.noul.toFixed(2)}` +
      `  severity=${r.answers.severity.score.toFixed(2)}` +
      `  "${r.text.slice(0, 50)}…"`,
  );
}

// Total tokens across all calls.
const totalIn = results.reduce((s, r) => s + r.usage.input_tokens, 0);
const totalOut = results.reduce((s, r) => s + r.usage.output_tokens, 0);
console.log(`\nTotal tokens: ${String(totalIn)} in / ${String(totalOut)} out`);
