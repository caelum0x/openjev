import { getSql } from "@/lib/db";
import { checkDriftAfterShadow } from "./drift.server";
import { escalateToLlm } from "./llm.server";
import { answerValue, LabelError, normalizeLabel, valueText, type LabelValue } from "./labels";
import { serveSystemOne } from "./run";
import { decisionConfidence } from "./scope";
import { stateProse, type SystemOneRequest, type SystemOneResponse } from "./types";
import { JevValidationError, validateRequest } from "./validate";

/**
 * Shadow mode (trust layer P1.3): run OpenJev alongside the customer's current
 * LLM on the same traffic, log agreement per question, and show what a cascade
 * would save. Zero-risk adoption: production keeps using the incumbent's
 * answers while we accumulate evidence.
 *
 * The reference answers come from either:
 *   - the caller (`incumbent.answers`), when they already paid for the LLM call
 *     in production and just forward its result (no extra spend), or
 *   - this server's configured LLM chain (Groq / Ollama / OpenAI-if-keyed),
 *     when the caller wants us to ask the LLM for them.
 */

export type ShadowInput = {
  userId: string;
  body: unknown;
};

export type ShadowComparison = {
  question_id: string;
  qtype: string;
  ours: string;
  incumbent: string;
  agree: boolean;
  confidence: number;
  ood: number | null;
};

export type ShadowResult = {
  batch_id: string;
  /**
   * `kind: "label"` when the caller sent human ground-truth labels (agreement
   * is accuracy), `"llm"` for an incumbent LLM (agreement is a proxy).
   */
  incumbent: { name: string; source: "caller" | "server_llm"; kind: "llm" | "label" };
  /** Calibration applied to our answers (and whose drift monitor sees this pair). */
  calibration_id: string | null;
  ours: SystemOneResponse;
  comparisons: ShadowComparison[];
  agreement: number;
};

const EXCERPT_CHARS = 280;

function bad(message: string): never {
  throw new JevValidationError("invalid_shadow", message);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonNegInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

/** Run one shadow comparison and persist a row per question. */
export async function runShadow(input: ShadowInput): Promise<ShadowResult> {
  if (!isObject(input.body)) bad("Body must be a JSON object.");
  const body = input.body;
  const req: SystemOneRequest = validateRequest({
    model: body.model ?? "system-one",
    state: body.state,
    questions: body.questions,
    ...(body.calibration_id !== undefined ? { calibration_id: body.calibration_id } : {}),
  });
  const inc = isObject(body.incumbent) ? body.incumbent : {};

  const ours = await serveSystemOne(req, { userId: input.userId });

  let incumbentName: string;
  let source: "caller" | "server_llm";
  let kind: "llm" | "label" = "llm";
  let incumbentValues: Record<string, LabelValue>;
  let incumbentLatency: number | null = null;
  let inTokens = 0;
  let outTokens = 0;

  if (isObject(inc.answers)) {
    source = "caller";
    if (inc.kind !== undefined && inc.kind !== "llm" && inc.kind !== "label") {
      bad('incumbent.kind must be "llm" or "label".');
    }
    kind = inc.kind === "label" ? "label" : "llm";
    incumbentName =
      typeof inc.name === "string" && inc.name.trim() ? inc.name.trim().slice(0, 80) : "incumbent";
    incumbentValues = {};
    for (const [qid, raw] of Object.entries(inc.answers)) {
      const q = req.questions[qid];
      if (!q) bad(`incumbent.answers.${qid} is not a question in this request.`);
      try {
        incumbentValues[qid] = normalizeLabel(qid, q, raw);
      } catch (err) {
        if (err instanceof LabelError) bad(`incumbent.answers: ${err.message}`);
        throw err;
      }
    }
    if (Object.keys(incumbentValues).length === 0) bad("incumbent.answers is empty.");
    incumbentLatency = typeof inc.latency_ms === "number" ? nonNegInt(inc.latency_ms) : null;
    const usage = isObject(inc.usage) ? inc.usage : {};
    inTokens = nonNegInt(usage.input_tokens);
    outTokens = nonNegInt(usage.output_tokens);
  } else {
    source = "server_llm";
    const llm = await escalateToLlm({ state: req.state, questions: req.questions });
    if (!llm.ok) {
      throw new JevValidationError(
        llm.reason === "no_llm_configured" ? "shadow_incumbent_unavailable" : "shadow_incumbent_failed",
        `${llm.detail} Or send your production LLM's answers as incumbent.answers.`,
      );
    }
    incumbentName = `${llm.provider}:${llm.model}`;
    incumbentValues = {};
    for (const [qid, a] of Object.entries(llm.answers)) incumbentValues[qid] = answerValue(a);
    incumbentLatency = llm.latency_ms;
    inTokens = llm.usage.input_tokens;
    outTokens = llm.usage.output_tokens;
  }

  const comparisons: ShadowComparison[] = [];
  for (const [qid, incValue] of Object.entries(incumbentValues)) {
    const a = ours.answers[qid];
    const q = req.questions[qid];
    if (!a || !q) continue;
    const mine = answerValue(a);
    comparisons.push({
      question_id: qid,
      qtype: q.type,
      ours: valueText(mine),
      incumbent: valueText(incValue),
      agree: mine === incValue,
      confidence: decisionConfidence(a),
      ood: typeof a.ood === "number" ? a.ood : null,
    });
  }

  // Attribute the pairs to a calibration only when it was actually applied.
  const calibrationId =
    ours.calibration && !ours.calibration.skipped_reason ? ours.calibration.id : null;
  const batchId = `shb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const excerpt = stateProse(req.state).slice(0, EXCERPT_CHARS);
  const perIn = comparisons.length ? Math.round(inTokens / comparisons.length) : 0;
  const perOut = comparisons.length ? Math.round(outTokens / comparisons.length) : 0;
  const sql = await getSql();
  for (const c of comparisons) {
    await sql.query(
      `insert into shadow_pairs
         (id, user_id, batch_id, model, incumbent, question_id, qtype, ours_value,
          incumbent_value, ours_confidence, ours_ood, agree, state_excerpt,
          ours_latency_ms, incumbent_latency_ms, incumbent_input_tokens, incumbent_output_tokens,
          calibration_id, reference_kind)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        `shp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        input.userId,
        batchId,
        ours.model,
        incumbentName,
        c.question_id,
        c.qtype,
        c.ours,
        c.incumbent,
        c.confidence,
        c.ood,
        c.agree,
        excerpt,
        Math.round(ours.latency_ms),
        incumbentLatency,
        perIn,
        perOut,
        calibrationId,
        kind,
      ],
    );
  }
  if (calibrationId && comparisons.length > 0) {
    await checkDriftAfterShadow(input.userId, calibrationId);
  }

  const agreed = comparisons.filter((c) => c.agree).length;
  return {
    batch_id: batchId,
    incumbent: { name: incumbentName, source, kind },
    calibration_id: calibrationId,
    ours,
    comparisons,
    agreement: comparisons.length ? agreed / comparisons.length : 0,
  };
}

// ─── Dashboard summary ────────────────────────────────────────────────────────

export type ShadowBand = { label: string; lo: number; hi: number; n: number; agreement: number | null };

export type ShadowSummary = {
  window_days: number;
  threshold: number;
  total: number;
  agreed: number;
  agreement: number | null;
  incumbents: string[];
  by_question: Array<{
    question_id: string;
    qtype: string;
    n: number;
    agreement: number;
    avg_confidence: number;
  }>;
  /** Agreement by our confidence: the evidence that confidence is trustworthy. */
  by_confidence: ShadowBand[];
  /** Pairs at or above the threshold: what a cascade would keep local. */
  above_threshold: { n: number; share: number; agreement: number | null };
  disagreements: Array<{
    id: string;
    question_id: string;
    ours: string;
    incumbent: string;
    confidence: number;
    state_excerpt: string;
    created_at: number;
  }>;
  savings: {
    incumbent_input_tokens: number;
    incumbent_output_tokens: number;
    incumbent_cost_usd: number;
    projected_savings_usd: number;
    price_in_usd_per_mtok: number;
    price_out_usd_per_mtok: number;
    price_source: "env" | "default";
  };
};

const BANDS: ReadonlyArray<[number, number]> = [
  [0, 0.5],
  [0.5, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0001],
];

/**
 * Assumed incumbent price per million tokens, used to project savings. Set
 * `SHADOW_INCUMBENT_USD_PER_MTOK_IN` / `_OUT` to your real LLM price; the
 * defaults are a small hosted model's list price and are labelled as such.
 */
function incumbentPrice(): { inP: number; outP: number; source: "env" | "default" } {
  const inEnv = Number(process.env.SHADOW_INCUMBENT_USD_PER_MTOK_IN);
  const outEnv = Number(process.env.SHADOW_INCUMBENT_USD_PER_MTOK_OUT);
  const fromEnv = Number.isFinite(inEnv) && inEnv >= 0 && Number.isFinite(outEnv) && outEnv >= 0;
  return fromEnv ? { inP: inEnv, outP: outEnv, source: "env" } : { inP: 0.4, outP: 1.6, source: "default" };
}

type PairRow = {
  id: string;
  question_id: string;
  qtype: string;
  incumbent: string;
  ours_value: string;
  incumbent_value: string;
  ours_confidence: number;
  agree: boolean;
  state_excerpt: string;
  incumbent_input_tokens: number;
  incumbent_output_tokens: number;
  created_at: number;
};

export async function shadowSummary(opts: {
  userId: string;
  days?: number;
  threshold?: number;
  incumbent?: string;
}): Promise<ShadowSummary> {
  const days = Math.min(Math.max(Math.round(opts.days ?? 30), 1), 365);
  const threshold = Math.min(Math.max(opts.threshold ?? 0.8, 0), 1);
  const sql = await getSql();
  const params: unknown[] = [opts.userId, days];
  let filter = "";
  if (opts.incumbent) {
    params.push(opts.incumbent);
    filter = ` and incumbent = $${params.length}`;
  }
  const rows = await sql.query<PairRow>(
    `select id, question_id, qtype, incumbent, ours_value, incumbent_value, ours_confidence,
            agree, state_excerpt, incumbent_input_tokens, incumbent_output_tokens,
            (extract(epoch from created_at) * 1000)::bigint as created_at
     from shadow_pairs
     where user_id = $1 and created_at >= now() - ($2::int * interval '1 day')${filter}
     order by created_at desc
     limit 20000`,
    params,
  );

  const total = rows.length;
  const agreed = rows.filter((r) => r.agree).length;

  const perQ = new Map<string, { qtype: string; n: number; agree: number; conf: number }>();
  for (const r of rows) {
    const b = perQ.get(r.question_id) ?? { qtype: r.qtype, n: 0, agree: 0, conf: 0 };
    b.n += 1;
    if (r.agree) b.agree += 1;
    b.conf += Number(r.ours_confidence);
    perQ.set(r.question_id, b);
  }

  const by_confidence: ShadowBand[] = BANDS.map(([lo, hi]) => {
    const inBand = rows.filter((r) => r.ours_confidence >= lo && r.ours_confidence < hi);
    const a = inBand.filter((r) => r.agree).length;
    return {
      label: `${lo.toFixed(1)}-${Math.min(hi, 1).toFixed(1)}`,
      lo,
      hi: Math.min(hi, 1),
      n: inBand.length,
      agreement: inBand.length ? a / inBand.length : null,
    };
  });

  const above = rows.filter((r) => r.ours_confidence >= threshold);
  const aboveAgree = above.filter((r) => r.agree).length;

  const price = incumbentPrice();
  let tin = 0;
  let tout = 0;
  let keptIn = 0;
  let keptOut = 0;
  for (const r of rows) {
    tin += Number(r.incumbent_input_tokens);
    tout += Number(r.incumbent_output_tokens);
    if (r.ours_confidence >= threshold) {
      keptIn += Number(r.incumbent_input_tokens);
      keptOut += Number(r.incumbent_output_tokens);
    }
  }
  const cost = (i: number, o: number) => (i * price.inP + o * price.outP) / 1_000_000;

  return {
    window_days: days,
    threshold,
    total,
    agreed,
    agreement: total ? agreed / total : null,
    incumbents: [...new Set(rows.map((r) => r.incumbent))],
    by_question: [...perQ.entries()]
      .map(([question_id, b]) => ({
        question_id,
        qtype: b.qtype,
        n: b.n,
        agreement: b.agree / b.n,
        avg_confidence: b.conf / b.n,
      }))
      .sort((x, y) => y.n - x.n),
    by_confidence,
    above_threshold: {
      n: above.length,
      share: total ? above.length / total : 0,
      agreement: above.length ? aboveAgree / above.length : null,
    },
    disagreements: rows
      .filter((r) => !r.agree)
      .slice(0, 25)
      .map((r) => ({
        id: r.id,
        question_id: r.question_id,
        ours: r.ours_value,
        incumbent: r.incumbent_value,
        confidence: Number(r.ours_confidence),
        state_excerpt: r.state_excerpt,
        created_at: Number(r.created_at),
      })),
    savings: {
      incumbent_input_tokens: tin,
      incumbent_output_tokens: tout,
      incumbent_cost_usd: cost(tin, tout),
      projected_savings_usd: cost(keptIn, keptOut),
      price_in_usd_per_mtok: price.inP,
      price_out_usd_per_mtok: price.outP,
      price_source: price.source,
    },
  };
}
