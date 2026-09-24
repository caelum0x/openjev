#!/usr/bin/env node
// Zero-dependency openjev example: rank ad hooks with typed decisions.
// Batches Choice + Score + Noul in ONE request per ad, then ranks by a
// code-owned policy over the returned probabilities. Node 18+ (built-in fetch).
//
//   npm run dev                                   # or: docker compose up
//   OPENJEV_BASE_URL=http://localhost:8080 node examples/rank-ads.mjs
//
// A self-hosted server needs no key; set OPENJEV_API_KEY if yours requires one.

const BASE_URL = (process.env.OPENJEV_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_URL = `${BASE_URL}/v1/systemone`;
const MODEL = process.env.OPENJEV_MODEL ?? "system-one";
const KEY = process.env.OPENJEV_API_KEY;

// --- Candidate ad hooks (this is the "build the option list in code" rule:
//     the model never invents candidates, it only judges the ones we hand it) ---
const ADS = [
  { id: "A", text: "Duolingo for every Turkish exam. 5 minutes a day, one streak, one app for KPSS, ALES and YDS." },
  { id: "B", text: "Stop paying 3,000₺ for a dershane. Pass ALES with 15 minutes of gamified practice a day." },
  { id: "C", text: "AI-generated questions that adapt to you. Score higher on TYT. Download now!!!" },
  { id: "D", text: "Herkes geçemez. Sen geçersin. ALES hazırlığı, cebinde, ücretsiz başla." },
];

// One batched question set, evaluated over each ad's state independently.
function questionsFor(ad) {
  return {
    // CHOICE — which single lever the hook pulls hardest
    primary_angle: {
      type: "choice",
      instructions: "Which single persuasion angle does this ad hook lean on hardest?",
      criteria: {
        cost_saving: "Framed around saving money vs an alternative (courses, tutors).",
        identity: "Framed around who the reader is / wants to become (pride, belonging).",
        convenience: "Framed around speed, ease, low daily effort, mobile.",
        novelty: "Framed around a new/AI capability or feature.",
      },
    },
    // SCORE — graded scroll-stopping strength, comparable across ads
    hook_strength: {
      type: "score",
      instructions: "Rate how strongly the first line would stop a paid-social scroll for a Turkish exam candidate.",
      criteria: [
        "Generic; blends into the feed.",
        "Mild interest; a clear but familiar promise.",
        "Strong; a specific tension or payoff that earns a pause.",
        "Exceptional; a pattern-break that demands the next line.",
      ],
    },
    // NOUL — independent yes/no flags (one per label, they may co-occur)
    is_slop: {
      type: "noul",
      instructions: "Does the copy read as low-quality AI 'slop' (hype punctuation, empty superlatives, exclamation spam)?",
      criteria: { true: "Reads as generic AI hype.", false: "Reads as deliberate human copy." },
    },
    is_policy_risk: {
      type: "noul",
      instructions: "Could this hook plausibly violate Meta ad policy (unrealistic guarantees, personal attributes, misleading claims)?",
      criteria: { true: "Plausible policy risk.", false: "Looks compliant." },
    },
  };
}

async function judge(ad) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state: ad.text, model: MODEL, questions: questionsFor(ad) }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ad ${ad.id}: ${await res.text()}`);
  }
  return res.json();
}

// Policy lives in CODE, not in the model. Raw judgments stay reusable;
// we can retune these weights without another inference call.
function rank(ad, r) {
  const a = r.answers;
  const strength = a.hook_strength.score;        // 0..3, probability-weighted
  const slop = a.is_slop.noul;                    // 0..1
  const risk = a.is_policy_risk.noul;             // 0..1
  const composite = strength - 1.5 * slop - 2.0 * risk;
  return {
    id: ad.id,
    angle: a.primary_angle.choice,
    angleConfidence: a.primary_angle.confidence,
    strength: +strength.toFixed(2),
    slop: +slop.toFixed(2),
    risk: +risk.toFixed(2),
    composite: +composite.toFixed(2),
    tokens: r.usage,
  };
}

(async () => {
  console.log(`Ranking ${ADS.length} ad hooks with ${MODEL}...\n`);
  const rows = [];
  let inTok = 0, outTok = 0;
  for (const ad of ADS) {
    const r = await judge(ad);
    const row = rank(ad, r);
    rows.push(row);
    inTok += r.usage?.input_tokens ?? 0;
    outTok += r.usage?.output_tokens ?? 0;
  }
  rows.sort((x, y) => y.composite - x.composite);

  console.log("rank  ad  composite  strength  slop  risk  angle (conf)");
  console.log("----  --  ---------  --------  ----  ----  ------------");
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padEnd(4)}  ${r.id}   ${String(r.composite).padStart(7)}   ${String(r.strength).padStart(6)}  ${String(r.slop).padStart(4)}  ${String(r.risk).padStart(4)}  ${r.angle} (${r.angleConfidence?.toFixed?.(2) ?? "?"})`
    );
  });

  const winner = rows[0];
  console.log(`\nWinner: ad ${winner.id} — lead with the "${winner.angle}" angle.`);
  console.log(`Total tokens: ${inTok} in / ${outTok} out across ${ADS.length} batched calls.`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
