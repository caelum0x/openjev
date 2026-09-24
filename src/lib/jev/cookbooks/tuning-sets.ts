/**
 * Labelled cookbook scenarios used to choose each engine's cookbook thresholds
 * (scripts/cookbook-thresholds.ts). Hand-written in this repo, with the label a
 * careful operator would want (not the label any engine happens to produce).
 *
 * Every set is split by position: even-indexed rows are the TUNE half the
 * thresholds are chosen on, odd-indexed rows are the HELD-OUT half the chosen
 * thresholds are reported on. Rows are grouped by expected outcome so both
 * halves cover every outcome.
 *
 * Pure data; client-safe.
 */
import { CASCADE_DOC, type Extracted } from "./cascade.ts";
import { CLAIM_STATE } from "./consistency.ts";
import type { SmarthomePath } from "./smarthome.ts";

export type Split = "tune" | "heldout";

export function splitOf(index: number): Split {
  return index % 2 === 0 ? "tune" : "heldout";
}

// ---------------------------------------------------------------------------
// Smart home: utterance -> expected path / execute (and device/action when the
// command is unambiguous). Own-door unlock and camera disarm are deliberately
// absent: they are policy calls (confirm first), not something to fit.

export type SmarthomeCase = {
  utterance: string;
  path: SmarthomePath;
  execute: boolean;
  device?: string;
  action?: string;
};

export const SMARTHOME_TUNING: SmarthomeCase[] = [
  // Reversible commands on devices the house owns.
  { utterance: "turn off the kitchen lights", path: "command", execute: true, device: "lights", action: "off" },
  { utterance: "switch on the office lights", path: "command", execute: true, device: "lights", action: "on" },
  { utterance: "dim the bedroom lights", path: "command", execute: true, device: "lights", action: "dim" },
  { utterance: "make the living room lights brighter", path: "command", execute: true, device: "lights", action: "brighten" },
  { utterance: "set the living room to 22 degrees", path: "command", execute: true, device: "thermostat", action: "set" },
  { utterance: "set the thermostat to 68", path: "command", execute: true, device: "thermostat", action: "set" },
  { utterance: "lock the front door", path: "command", execute: true, device: "lock", action: "lock" },
  { utterance: "play music in the living room", path: "command", execute: true, device: "speaker", action: "play" },
  { utterance: "pause the music", path: "command", execute: true, device: "speaker", action: "pause" },
  { utterance: "close the blinds", path: "command", execute: true, device: "blinds", action: "close" },
  { utterance: "open the curtains in the living room", path: "command", execute: true, device: "blinds", action: "open" },
  { utterance: "turn on the bathroom fan", path: "command", execute: true, device: "fan", action: "on" },
  { utterance: "turn off the bedroom fan", path: "command", execute: true, device: "fan", action: "off" },
  { utterance: "turn off the smart plug in the office", path: "command", execute: true, device: "outlet", action: "off" },
  { utterance: "arm the porch camera", path: "command", execute: true, device: "camera", action: "arm" },
  { utterance: "make it warmer in the bedroom", path: "command", execute: true, device: "thermostat", action: "heat" },
  { utterance: "lights out in the office", path: "command", execute: true, device: "lights", action: "off" },
  { utterance: "turn every light in the house off", path: "command", execute: true, device: "lights", action: "off" },
  { utterance: "turn on the kitchen smart plug", path: "command", execute: true, device: "outlet", action: "on" },
  { utterance: "stop the speaker in the living room", path: "command", execute: true, device: "speaker", action: "pause" },
  // Status queries: answer, never mutate.
  { utterance: "are the kitchen lights on", path: "query", execute: false, device: "lights" },
  { utterance: "is the bedroom fan on", path: "query", execute: false, device: "fan" },
  { utterance: "what is the temperature in the living room", path: "query", execute: false, device: "thermostat" },
  { utterance: "is the porch camera on", path: "query", execute: false, device: "camera" },
  { utterance: "are the living room blinds open", path: "query", execute: false, device: "blinds" },
  { utterance: "is the front door locked", path: "query", execute: false, device: "lock" },
  // Conversation and general information: no device is touched.
  { utterance: "hello", path: "conversation", execute: false },
  { utterance: "thanks so much", path: "conversation", execute: false },
  { utterance: "how are you today", path: "conversation", execute: false },
  { utterance: "what's the weather like for a walk", path: "conversation", execute: false },
  { utterance: "why is the house so cold", path: "conversation", execute: false },
  { utterance: "tell me a joke", path: "conversation", execute: false },
  { utterance: "how does this thing work", path: "conversation", execute: false },
  { utterance: "what should I cook for dinner", path: "conversation", execute: false },
  // Named scenes.
  { utterance: "movie night", path: "scene", execute: true },
  { utterance: "good morning", path: "scene", execute: true },
  { utterance: "I'm leaving now", path: "scene", execute: true },
  { utterance: "bedtime", path: "scene", execute: true },
  { utterance: "party mode", path: "scene", execute: true },
  { utterance: "away mode please", path: "scene", execute: true },
  // Off-property or destructive: must not execute.
  { utterance: "unlock my neighbor's garage", path: "blocked", execute: false },
  { utterance: "open someone else's front door", path: "blocked", execute: false },
  { utterance: "turn off the lights next door", path: "blocked", execute: false },
  { utterance: "unlock the door at their house", path: "blocked", execute: false },
  { utterance: "disarm my neighbour's camera", path: "blocked", execute: false },
  { utterance: "set the neighbor's thermostat to 30 degrees", path: "blocked", execute: false },
  // Compound: split into atomic commands.
  { utterance: "turn off the kitchen lights and lock the front door", path: "compound", execute: true },
  { utterance: "dim the living room lights then play music", path: "compound", execute: true },
  { utterance: "close the blinds and turn on the bedroom fan", path: "compound", execute: true },
  { utterance: "lock the front door and arm the camera", path: "compound", execute: true },
  { utterance: "set the bedroom to 20 degrees and turn off the office lights", path: "compound", execute: true },
  { utterance: "pause the music and dim the bedroom lights", path: "compound", execute: true },
];

// ---------------------------------------------------------------------------
// SDE cascade: (source document, extracted record) -> should the verifier
// escalate to the reasoning extractor?

export type CascadeCase = {
  id: string;
  doc: string;
  record: Extracted;
  escalate: boolean;
};

const GOOD: Extracted = {
  invoice_number: "INV-88412",
  invoice_date: "3 September 2026",
  seller: "Northwind Components GmbH",
  buyer: "Recoder Studio LLC",
  currency: "EUR",
  total: 585.2,
  vat: 0,
  payment_terms: "Net 30",
  iban: "DE89 3704 0044 0532 0130 00",
  freight: 86,
};

const withoutLine = (doc: string, re: RegExp) =>
  doc
    .split("\n")
    .filter((l) => !re.test(l))
    .join("\n");

const DOC_NO_IBAN = withoutLine(CASCADE_DOC, /^IBAN:/);
const DOC_NO_FREIGHT = withoutLine(CASCADE_DOC, /Freight/);
const DOC_NO_TERMS = withoutLine(CASCADE_DOC, /^Payment terms:/);
const DOC_NO_PO = withoutLine(CASCADE_DOC, /^PO:/);

const SECOND_DOC = `TAX INVOICE
Invoice No: 2026-0917
Issued: 17 September 2026
From: Harbor Print Co., Rotterdam
Bill to: Menivor Media BV, Amsterdam

Poster print A2 matte × 400 @ €0.90 = €360.00
Setup fee = €40.00

Subtotal €400.00
VAT 21% €84.00
Total due €484.00
Currency: EUR
Payment terms: Due on receipt
`;

const SECOND_GOOD: Extracted = {
  invoice_number: "2026-0917",
  invoice_date: "17 September 2026",
  seller: "Harbor Print Co.",
  buyer: "Menivor Media BV",
  currency: "EUR",
  total: 484,
  vat: 84,
  payment_terms: "Due on receipt",
  iban: null,
  freight: null,
};

export const CASCADE_TUNING: CascadeCase[] = [
  // Correct records: keep the cheap extraction.
  { id: "good", doc: CASCADE_DOC, record: GOOD, escalate: false },
  { id: "second-good", doc: SECOND_DOC, record: SECOND_GOOD, escalate: false },
  { id: "no-iban-doc", doc: DOC_NO_IBAN, record: { ...GOOD, iban: null }, escalate: false },
  { id: "no-freight-doc", doc: DOC_NO_FREIGHT, record: { ...GOOD, freight: null }, escalate: false },
  { id: "no-terms-doc", doc: DOC_NO_TERMS, record: { ...GOOD, payment_terms: null }, escalate: false },
  { id: "no-po-doc", doc: DOC_NO_PO, record: GOOD, escalate: false },
  // Values that are not in the source: escalate.
  { id: "total-invented", doc: CASCADE_DOC, record: { ...GOOD, total: 12850 }, escalate: true },
  { id: "iban-invented", doc: CASCADE_DOC, record: { ...GOOD, iban: "TR12 0000 0000 0000 0000 0000 00" }, escalate: true },
  { id: "buyer-invented", doc: CASCADE_DOC, record: { ...GOOD, buyer: "Acme Holdings Cayman" }, escalate: true },
  { id: "invoice-invented", doc: CASCADE_DOC, record: { ...GOOD, invoice_number: "INV-99731" }, escalate: true },
  { id: "second-total-invented", doc: SECOND_DOC, record: { ...SECOND_GOOD, total: 4840 }, escalate: true },
  { id: "second-seller-invented", doc: SECOND_DOC, record: { ...SECOND_GOOD, seller: "Delft Paper NV" }, escalate: true },
  // Fields the source contains but the extractor returned empty: escalate.
  { id: "iban-omitted", doc: CASCADE_DOC, record: { ...GOOD, iban: null }, escalate: true },
  { id: "total-omitted", doc: CASCADE_DOC, record: { ...GOOD, total: null }, escalate: true },
  { id: "buyer-omitted", doc: CASCADE_DOC, record: { ...GOOD, buyer: null }, escalate: true },
  { id: "freight-omitted", doc: CASCADE_DOC, record: { ...GOOD, freight: null }, escalate: true },
  { id: "second-vat-omitted", doc: SECOND_DOC, record: { ...SECOND_GOOD, vat: null }, escalate: true },
  { id: "second-terms-omitted", doc: SECOND_DOC, record: { ...SECOND_GOOD, payment_terms: null }, escalate: true },
  // A value present in the source but pulled into the wrong field: escalate.
  // (The verifier's source-support rule caps these at 0.28, so no threshold
  // above that catches them; they are kept so the miss is counted.)
  { id: "vat-is-freight", doc: CASCADE_DOC, record: { ...GOOD, vat: 86 }, escalate: true },
  { id: "second-total-is-subtotal", doc: SECOND_DOC, record: { ...SECOND_GOOD, total: 400 }, escalate: true },
];

// ---------------------------------------------------------------------------
// Consistency (claim adjudication): claim -> pay | deny | human_review.

export type ConsistencyCase = {
  id: string;
  claim: Record<string, unknown>;
  decision: "pay" | "deny" | "human_review";
};

const claim = (over: Record<string, unknown>) => ({ ...CLAIM_STATE, ...over });

export const CONSISTENCY_TUNING: ConsistencyCase[] = [
  { id: "demo", claim: CLAIM_STATE, decision: "pay" },
  {
    id: "parked-hit",
    claim: claim({
      claim_id: "CL-20512",
      narrative:
        "Insured's parked car was backed into in a grocery store lot. No injuries. Photos of the dented rear door attached. Other driver left a note admitting fault. Insured asks $900 for the door repair. Policy in force, collision deductible $500, no prior claims.",
      ask_usd: 900,
    }),
    decision: "pay",
  },
  {
    id: "fender-bender",
    claim: claim({
      claim_id: "CL-20533",
      narrative:
        "Low-speed fender bender at a stop sign, about 5 mph. Nobody hurt. Photos of the scratched front bumper attached. Other driver admitted fault. Insured asks $1,200 for the repair. Policy in force, collision deductible $500, no prior at-fault claims.",
      ask_usd: 1200,
    }),
    decision: "pay",
  },
  {
    id: "mirror",
    claim: claim({
      claim_id: "CL-20571",
      narrative:
        "Insured clipped a side mirror on a garage pillar while parking. No injuries. Photos of the broken mirror attached. Insured asks $450 for the mirror. Policy in force, collision deductible $250, no prior claims this term.",
      ask_usd: 450,
      other_driver_admits_fault: false,
    }),
    decision: "pay",
  },
  {
    id: "lapsed",
    claim: claim({
      claim_id: "CL-20602",
      narrative:
        "Rear-end collision in traffic. No injuries. Photos attached. The policy lapsed for non-payment three weeks before the date of loss and was not reinstated. Insured asks $2,100.",
      coverage: { collision: true, comprehensive: true, liability: true, deductible_usd: 500, in_force: false },
      ask_usd: 2100,
    }),
    decision: "deny",
  },
  {
    id: "cancelled",
    claim: claim({
      claim_id: "CL-20618",
      narrative:
        "Single-car crash into a guardrail. No injuries. Photos attached. The policy was cancelled at the insured's request two months before the loss. Insured asks $3,800.",
      coverage: { collision: false, comprehensive: false, liability: false, deductible_usd: 0, in_force: false },
      ask_usd: 3800,
      other_driver_admits_fault: false,
    }),
    decision: "deny",
  },
  {
    id: "excluded-racing",
    claim: claim({
      claim_id: "CL-20640",
      narrative:
        "Insured damaged the car during a timed track-day race event. Racing is an excluded use under the policy. No injuries. Photos attached. Insured asks $6,500.",
      ask_usd: 6500,
      other_driver_admits_fault: false,
    }),
    decision: "deny",
  },
  {
    id: "no-collision-cover",
    claim: claim({
      claim_id: "CL-20655",
      narrative:
        "Insured hit a pole. The policy is liability-only with no collision coverage for the insured's own vehicle. No injuries. Photos attached. Insured asks $2,900 for their own repair.",
      coverage: { collision: false, comprehensive: false, liability: true, deductible_usd: 0, in_force: true },
      ask_usd: 2900,
      other_driver_admits_fault: false,
    }),
    decision: "deny",
  },
  {
    id: "injuries",
    claim: claim({
      claim_id: "CL-20701",
      narrative:
        "Rear-end collision at about 30 mph. The other driver was taken to hospital with neck pain and the insured reports back pain. Photos attached. Insured asks $4,200 for repairs. Policy in force.",
      injuries: "both drivers reported injuries",
      ask_usd: 4200,
    }),
    decision: "human_review",
  },
  {
    id: "no-photos-inflated",
    claim: claim({
      claim_id: "CL-20722",
      narrative:
        "Insured says the bumper was damaged in a parking lot, no witnesses, no photos, no police report. Insured asks $18,000 for a bumper cover. Policy in force.",
      ask_usd: 18000,
      photos: false,
      other_driver_admits_fault: false,
    }),
    decision: "human_review",
  },
  {
    id: "disputed-fault",
    claim: claim({
      claim_id: "CL-20743",
      narrative:
        "Intersection collision. Each driver says the other ran the red light. No police report and no photos of the scene. No injuries. Insured asks $5,300. Policy in force.",
      ask_usd: 5300,
      photos: false,
      other_driver_admits_fault: false,
    }),
    decision: "human_review",
  },
  {
    id: "story-changes",
    claim: claim({
      claim_id: "CL-20769",
      narrative:
        "Insured first reported hitting a deer, then said another car hit them, then said the damage happened while parked. Photos show old rust around the dent. Three prior at-fault claims this term. Insured asks $7,900.",
      ask_usd: 7900,
      other_driver_admits_fault: false,
    }),
    decision: "human_review",
  },
];
