/**
 * Inspecting the HTTP response: request ID, status, and headers.
 *
 * APIPromise exposes two opt-in accessors beyond the parsed body:
 *   - withResponse()  → { data, response, requestId }  (parses body + keeps Response)
 *   - asResponse()    → raw Response (skip parsing; you own the body stream)
 *
 * Use withResponse() when you need to log the request ID, forward headers, or
 * inspect the HTTP status code alongside the typed answer.
 *
 * Run with:
 *   TYPESAFE_API_KEY=<key> npx tsx examples/03-inspect-response.ts
 */
import { noul, OpenJevClient } from "../src";

const client = new OpenJevClient({ logLevel: "info" });

// withResponse() settles after both the HTTP round-trip and JSON parsing complete.
const { data, response, requestId } = await client
  .systemOne({
    state: "Unsubscribe me from all marketing emails.",
    questions: {
      isOptOut: noul("Is the user requesting to opt out of communications?"),
    },
  })
  .withResponse();

console.log("HTTP status :", response.status);
console.log("Request ID  :", requestId ?? "(none)");
console.log("Model       :", data.model);
console.log("Opt-out?    :", data.answers.isOptOut.noul.toFixed(3));

// ---
// models.list() also returns an APIPromise — same accessor works everywhere.
const { data: models, requestId: modelsRequestId } = await client.models.list().withResponse();
console.log("\nModels request ID:", modelsRequestId ?? "(none)");
console.log("Available models:", models.map((m) => m.name).join(", "));
