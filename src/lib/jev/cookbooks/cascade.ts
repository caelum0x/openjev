import { lexicalEvaluator, type Evaluator } from "./evaluator.ts";
import type { NoulAnswer, Questions } from "../types.ts";
import { round4 } from "../vector.ts";
import { thresholdInfo, thresholdsFor, type CascadeGates } from "./thresholds.ts";

export const CASCADE_DOC = `COMMERCIAL INVOICE
Invoice #: INV-88412
Date: 3 September 2026
Seller: Northwind Components GmbH, Berlin
Buyer: Recoder Studio LLC, Istanbul
PO: PO-4419

Line items:
1. AL-2044 aluminum extrusion 40x40, 2.0m × 24 pcs @ €18.50 = €444.00
2. T-nut M8 pack of 50 × 6 @ €9.20 = €55.20
3. Freight (DDP Istanbul) = €86.00

Subtotal €499.20
VAT 0% (export) €0.00
Total due €585.20
Currency: EUR
Payment terms: Net 30
IBAN: DE89 3704 0044 0532 0130 00
Notes: Ship to warehouse dock B. Do not include spare blades — buyer declined.
`;

export const CASCADE_SCHEMA = {
  invoice_number: { type: "string", description: "Seller invoice id" },
  invoice_date: { type: "string", description: "Invoice date" },
  seller: { type: "string", description: "Selling company name" },
  buyer: { type: "string", description: "Buying company name" },
  currency: { type: "string", description: "ISO currency code" },
  total: { type: "number", description: "Total amount due" },
  vat: { type: "number", description: "VAT amount" },
  payment_terms: { type: "string", description: "Payment terms" },
  iban: { type: "string", description: "Beneficiary IBAN if present" },
  freight: { type: "number", description: "Freight charge" },
};

export type Extracted = Record<string, string | number | null>;

export function miniExtract(doc: string, poison = false): Extracted {
  const num = (re: RegExp) => {
    const m = re.exec(doc);
    if (!m?.[1]) return null;
    const n = Number(m[1].replace(",", ""));
    return Number.isFinite(n) ? n : null;
  };
  const str = (re: RegExp) => {
    const m = re.exec(doc);
    return m?.[1]?.trim() ?? null;
  };
  const rec: Extracted = {
    invoice_number: str(/Invoice\s*#:\s*([A-Z0-9-]+)/i),
    invoice_date: str(/Date:\s*([^\n]+)/i),
    seller: str(/Seller:\s*([^,\n]+)/i),
    buyer: str(/Buyer:\s*([^,\n]+)/i),
    currency: str(/Currency:\s*([A-Z]{3})/i),
    total: num(/Total due\s*€?\s*([0-9.]+)/i),
    vat: num(/VAT[^\n]*€\s*([0-9.]+)/i),
    payment_terms: str(/Payment terms:\s*([^\n]+)/i),
    iban: str(/IBAN:\s*([A-Z0-9 ]+)/i),
    freight: num(/Freight[^\n]*€\s*([0-9.]+)/i),
  };
  if (poison) {
    rec.total = 12850;
    rec.iban = "TR12 0000 0000 0000 0000 0000 00";
    rec.buyer = "Acme Holdings Cayman";
  }
  return rec;
}

const METRICS: Array<{
  id: string;
  instructions: string;
  true: string;
  false: string;
}> = [
  {
    id: "hallucinated",
    instructions: "Is the extracted_field unsupported by, or absent from, the source text?",
    true: "hallucinated or absent",
    false: "supported by the source",
  },
  {
    id: "off_target",
    instructions:
      "Was the extracted_field pulled from incidental text rather than the field the spec describes?",
    true: "from incidental text",
    false: "genuinely that field",
  },
  {
    id: "unreasonable",
    instructions: "Would a reasonable person not have extracted this value for this field?",
    true: "unreasonable",
    false: "reasonable",
  },
  {
    id: "format_violation",
    instructions: "Does the extracted_field violate the format implied by the field spec?",
    true: "violates format",
    false: "satisfies format",
  },
];

function supportedBySource(value: string | number | null, doc: string): boolean {
  if (value === null || value === "") return true;
  const hay = doc.toLowerCase().replace(/\s+/g, " ");
  const needles: string[] = [];
  if (typeof value === "number") {
    needles.push(String(value), value.toFixed(2), value.toFixed(1), String(Math.round(value)));
  } else {
    needles.push(value.toLowerCase().trim());
  }
  for (const needle of needles) {
    if (!needle) continue;
    if (hay.includes(needle)) return true;
    const compact = needle.replace(/\s+/g, "");
    if (compact.length >= 6 && hay.replace(/\s+/g, "").includes(compact)) return true;
  }
  return false;
}

/**
 * Words that label each field in a document. When none of them appears in the
 * source, an empty extraction is correct by construction ("no IBAN line, no
 * IBAN"), whatever the engine says about the absence.
 */
const FIELD_LABELS: Record<string, RegExp> = {
  invoice_number: /\binvoice\s*(#|no\b|number\b|id\b)/i,
  invoice_date: /\b(date|issued|dated)\b/i,
  seller: /\b(seller|from|supplier|vendor)\b/i,
  buyer: /\b(buyer|bill to|customer|sold to)\b/i,
  currency: /\b(currency|eur|usd|gbp|try)\b|[€$£]/i,
  total: /\btotal\b/i,
  vat: /\b(vat|tax)\b/i,
  payment_terms: /\b(payment terms|terms|due on|net \d+)\b/i,
  iban: /\biban\b/i,
  freight: /\b(freight|shipping|delivery charge)\b/i,
};

function fieldLabelInSource(field: string, doc: string): boolean {
  const re = FIELD_LABELS[field];
  if (re) return re.test(doc);
  return doc.toLowerCase().includes(field.replace(/_/g, " ").toLowerCase());
}

export async function verifyExtract(
  doc: string,
  record: Extracted,
  model = "system-one",
  evaluate: Evaluator = lexicalEvaluator,
  /** Override the engine's fire threshold (the threshold tuner sweeps it). */
  gatesOverride?: CascadeGates,
) {
  const questions: Questions = {};
  for (const [name, value] of Object.entries(record)) {
    const spec = {
      path: name,
      ...(CASCADE_SCHEMA[name as keyof typeof CASCADE_SCHEMA] ?? {
        type: "string",
        description: name,
      }),
    };
    const empty =
      value === null ||
      value === "" ||
      (typeof value === "number" && Number.isNaN(value));
    if (empty) {
      questions[`${name}::absence_wrong`] = {
        type: "noul",
        instructions: JSON.stringify({
          field_spec: spec,
          extracted_field: value,
          main_question:
            "The field is empty. Does the source text contain a value a reasonable extractor should have returned?",
        }),
        criteria: {
          true: "wrongly omitted",
          false: "correct to return nothing",
        },
      };
      continue;
    }
    for (const m of METRICS) {
      questions[`${name}::${m.id}`] = {
        type: "noul",
        instructions: JSON.stringify({
          field_spec: spec,
          extracted_field: value,
          source_excerpt: doc.slice(0, 900),
          main_question: m.instructions,
        }),
        criteria: { true: m.true, false: m.false },
      };
    }
  }

  const out = await evaluate({ model, state: { source: doc, record }, questions });
  const set = thresholdsFor(out.engine);
  const gates = gatesOverride ?? set.values.cascade;
  const FIRE_T = gates.fire;
  const flags: Array<{ id: string; noul: number; fire: boolean }> = [];
  let maxWrong = 0;
  for (const [id, ans] of Object.entries(out.answers)) {
    if (ans.type !== "noul") continue;
    let n = (ans as NoulAnswer).noul;
    const field = id.split("::")[0] ?? "";
    const metric = id.split("::")[1];
    const value = record[field];
    const inSource = supportedBySource(value ?? null, doc);
    if (metric === "hallucinated" && value != null && !inSource) {
      n = Math.max(n, 0.92);
    } else if (metric === "absence_wrong" && !fieldLabelInSource(field, doc)) {
      n = Math.min(n, 0.28);
    } else if (metric !== "absence_wrong" && inSource) {
      n = Math.min(n, 0.28);
    }
    if (n > maxWrong) maxWrong = n;
    flags.push({ id, noul: round4(n), fire: n > FIRE_T });
  }
  flags.sort((a, b) => b.noul - a.noul);
  const escalate = maxWrong > FIRE_T;
  return {
    model: out.model,
    engine: out.engine ?? null,
    usage: out.usage,
    latency_ms: out.latency_ms,
    fire_threshold: FIRE_T,
    thresholds: gatesOverride
      ? { set: "override" as const, fitted_on: null, values: gatesOverride }
      : thresholdInfo(set, "cascade"),
    max_wrong: Math.round(maxWrong * 10000) / 10000,
    escalate,
    flags,
  };
}

export async function runCascade(opts?: {
  poison?: boolean;
  model?: string;
  evaluate?: Evaluator;
}) {
  const model = opts?.model ?? "system-one";
  const poison = Boolean(opts?.poison);
  const t0 = Date.now();
  const extracted = miniExtract(CASCADE_DOC, poison);
  const verify = await verifyExtract(CASCADE_DOC, extracted, model, opts?.evaluate);
  const corrected: Extracted =
    poison && verify.escalate ? miniExtract(CASCADE_DOC, false) : extracted;
  return {
    stages: {
      mini: { model: "extractor-mini", record: extracted },
      verify,
      reasoning: verify.escalate
        ? {
            escalated: true,
            model: "extractor-reasoner",
            record: corrected,
            reason: `max P(wrong)=${verify.max_wrong} > ${verify.fire_threshold}`,
          }
        : { escalated: false, kept: extracted },
    },
    final: corrected,
    model: verify.model,
    engine: verify.engine,
    latency_ms: Date.now() - t0,
  };
}

export const CASCADE_META = {
  id: "cascade",
  title: "SDE cascade",
  blurb:
    "A 2-stage structured-data-extraction cascade: cheap extract → per-field noul verify → escalate only when P(wrong) fires. Most of a reasoner's quality, a fraction of the cost.",
  stat: "mini → verify → reason",
  href: "/cookbooks/cascade",
};
