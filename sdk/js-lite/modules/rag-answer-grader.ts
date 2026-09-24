/**
 * RAG answer grader — OpenJev quality gate for retrieval-augmented generation.
 *
 * RAG pipelines fail in two distinct ways:
 *   1. Retrieval failures: the retrieved chunks do not contain the answer.
 *   2. Generation failures: the LLM hallucinates facts not present in the chunks.
 *
 * A downstream user never knows which failure mode caused a bad answer. This
 * module lets you detect both before serving the answer, so you can either
 * re-retrieve, escalate to a larger model, or surface a "I don't know" rather
 * than a confident hallucination.
 *
 * Pattern:
 *   1. Run your RAG pipeline as normal.
 *   2. Call `gradeAnswer` with the question, the generated answer, and the
 *      retrieved chunks that were passed to the generator.
 *   3. Gate on `shouldServe`: only serve answers that pass the grounding check.
 *   4. Use `gradeAnswerBatch` for offline evaluation of your pipeline.
 *
 * Functions:
 *   gradeAnswer       – grade one RAG answer
 *   gradeAnswerBatch  – concurrent grading for a batch
 *   buildGradingReport – aggregate quality metrics across a batch
 */

import { OpenJevClient } from '../src/client.ts';
import { noul, score, choice, isNoul, isScore, isChoice } from '../src/primitives.ts';
import { decideNoul, decideScore, decideChoice } from '../src/decide.ts';

// ---- Types ----------------------------------------------------------------

/** One retrieved chunk passed to the generator. */
export interface RetrievedChunk {
  /** Unique identifier for this chunk (document id + chunk index). */
  readonly id: string;
  /** The text content of the chunk as it was passed to the generator. */
  readonly text: string;
  /** Optional similarity score from your vector search (0..1). */
  readonly score?: number;
  /** Source document label, e.g. file name or URL. */
  readonly source?: string;
}

/** A question + answer pair with its source chunks. */
export interface RAGQuery {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly retrievedChunks: readonly RetrievedChunk[];
  /** Optional ground-truth answer, if available (for offline evaluation). */
  readonly groundTruth?: string;
}

/**
 * The quality assessment for one RAG answer.
 *
 * `shouldServe` is the primary gate: when false, do not surface this answer
 * to the user. Instead, re-retrieve, escalate to a larger model, or respond
 * with a graceful "I don't know".
 */
export interface AnswerGrade {
  readonly id: string;
  /** True when the answer is grounded in the retrieved chunks. */
  readonly grounded: boolean;
  /** 0..3 completeness: how well does the answer cover all parts of the question? */
  readonly completeness: number;
  /**
   * 0..3 faithfulness: does the answer stay true to the source chunks without
   * adding unsupported claims?
   */
  readonly faithfulness: number;
  /** 0..3 relevance: does the answer directly address what was asked? */
  readonly relevance: number;
  /**
   * True when the answer contains claims that are not supported by any of the
   * retrieved chunks (the classic RAG hallucination).
   */
  readonly hallucination: boolean;
  /**
   * True when the retrieved chunks did not contain sufficient information to
   * answer the question. This is a retrieval failure, not a generation failure.
   */
  readonly retrievalInsufficient: boolean;
  /** Serve this answer to the user. */
  readonly shouldServe: boolean;
  /**
   * When `shouldServe` is false, what went wrong?
   * `grounding`    – answer contains hallucinated facts.
   * `retrieval`    – chunks did not have the information needed.
   * `relevance`    – answer does not address the question.
   * `confidence`   – model was too uncertain to make a call.
   */
  readonly failureMode:
    | 'grounding'
    | 'retrieval'
    | 'relevance'
    | 'confidence'
    | 'none';
  readonly confidence: number;
  readonly reason: string;
}

// ---- Shared level scales --------------------------------------------------

const COMPLETENESS_LEVELS = [
  'Incomplete: only addresses part of the question or leaves major gaps.',
  'Partial: covers the main point but misses important nuances.',
  'Mostly complete: addresses the question well with only minor gaps.',
  'Complete: fully and thoroughly answers all parts of the question.',
] as const;

const FAITHFULNESS_LEVELS = [
  'Unfaithful: contains claims that contradict or are absent from the source chunks.',
  'Mostly faithful: a few small claims are unsupported or stretched.',
  'Faithful: claims are well-supported with only minor liberties.',
  'Perfectly faithful: every claim is directly traceable to the source chunks.',
] as const;

const RELEVANCE_LEVELS = [
  'Irrelevant: does not address what was asked.',
  'Tangential: partially related but misses the core of the question.',
  'Relevant: directly addresses the question.',
  'Highly relevant: answers exactly what was asked with no off-topic content.',
] as const;

// ---- gradeAnswer ----------------------------------------------------------

/**
 * Grade one RAG answer for grounding, completeness, faithfulness, and relevance.
 * All questions are batched into one API call.
 *
 * The `shouldServe` flag is computed from the individual dimension verdicts using
 * the thresholds below. Adjust them to match your quality bar.
 *
 * Thresholds (defaults):
 *   - hallucination confidence >= 0.7 -> hallucination=true, do not serve
 *   - faithfulness < 1.5               -> do not serve (unfaithful answer)
 *   - relevance < 1.5                  -> do not serve (off-topic)
 *   - retrievalInsufficient + completeness < 1.5 -> do not serve (retrieval gap)
 */
export async function gradeAnswer(
  client: OpenJevClient,
  query: RAGQuery,
): Promise<AnswerGrade> {
  // Truncate chunks to avoid overwhelming the context — keep the top 5 by score.
  const sortedChunks = [...query.retrievedChunks]
    .sort((a, b) => (b.score ?? 0.5) - (a.score ?? 0.5))
    .slice(0, 5);

  const res = await client.systemOne({
    state: {
      question: query.question,
      answer: query.answer,
      retrievedChunks: sortedChunks.map((c) => ({
        id: c.id,
        text: c.text,
        source: c.source ?? null,
        retrievalScore: c.score ?? null,
      })),
      groundTruth: query.groundTruth ?? null,
      note: 'Grade this RAG-generated answer. The "retrieved chunks" are exactly what was given to the generator — nothing outside them should appear in the answer unless it is common knowledge. Judge faithfulness strictly: any claim not traceable to a chunk is a hallucination.',
    },
    questions: {
      completeness: score(
        'How completely does the answer address all parts of the question?',
        COMPLETENESS_LEVELS,
      ),
      faithfulness: score(
        'How faithfully does the answer stay within the retrieved source chunks (no hallucinated claims)?',
        FAITHFULNESS_LEVELS,
      ),
      relevance: score(
        'How directly and precisely does the answer address what was asked?',
        RELEVANCE_LEVELS,
      ),
      hallucination: noul(
        'Does the answer contain any factual claims that are NOT supported by the retrieved chunks? (Hallucination = yes.)',
        {
          true: 'The answer introduces claims not present in the source chunks',
          false: 'All claims are grounded in the retrieved content',
        },
      ),
      retrievalInsufficient: noul(
        'Were the retrieved chunks insufficient to answer this question? (The generator was set up to fail because the right content was not retrieved.)',
        {
          true: 'The chunks lack the information needed to answer the question',
          false: 'The chunks contain enough information to answer the question',
        },
      ),
    },
  });

  const compAns = res.answers.completeness;
  const faithAns = res.answers.faithfulness;
  const relAns = res.answers.relevance;
  const hallAns = res.answers.hallucination;
  const retrievalAns = res.answers.retrievalInsufficient;

  const completeness = isScore(compAns) ? compAns.score : 0;
  const faithfulness = isScore(faithAns) ? faithAns.score : 0;
  const relevance = isScore(relAns) ? relAns.score : 0;
  const confidence = isScore(faithAns) ? faithAns.confidence : 0;

  const hallucination =
    isNoul(hallAns) && decideNoul(hallAns, { yes: 0.7, no: 0.3 }).outcome === 'yes';

  const retrievalInsufficient =
    isNoul(retrievalAns) && decideNoul(retrievalAns, { yes: 0.65 }).outcome === 'yes';

  const faithVerdict = isScore(faithAns)
    ? decideScore(faithAns, { atOrAbove: 1.5, minConfidence: 0.55 })
    : null;
  const relVerdict = isScore(relAns)
    ? decideScore(relAns, { atOrAbove: 1.5, minConfidence: 0.55 })
    : null;
  const compVerdict = isScore(compAns)
    ? decideScore(compAns, { atOrAbove: 1.5, minConfidence: 0.55 })
    : null;

  const grounded = !hallucination && faithfulness >= 1.5;

  let shouldServe = false;
  let failureMode: AnswerGrade['failureMode'] = 'none';
  let reason = 'answer passed all quality checks';

  if (hallucination) {
    failureMode = 'grounding';
    reason = 'hallucination detected: answer contains unsupported claims';
  } else if (faithVerdict?.outcome === 'below') {
    failureMode = 'grounding';
    reason = `faithfulness too low (${faithfulness.toFixed(2)})`;
  } else if (relVerdict?.outcome === 'below') {
    failureMode = 'relevance';
    reason = `relevance too low (${relevance.toFixed(2)})`;
  } else if (retrievalInsufficient && compVerdict?.outcome === 'below') {
    failureMode = 'retrieval';
    reason = 'retrieval insufficient and answer is incomplete';
  } else if (confidence < 0.5) {
    failureMode = 'confidence';
    reason = `model confidence too low (${confidence.toFixed(2)}) — cannot make a reliable call`;
  } else {
    shouldServe = true;
  }

  return {
    id: query.id,
    grounded,
    completeness,
    faithfulness,
    relevance,
    hallucination,
    retrievalInsufficient,
    shouldServe,
    failureMode,
    confidence,
    reason,
  };
}

// ---- gradeAnswerBatch -----------------------------------------------------

/**
 * Grade multiple RAG answers concurrently. Each answer is one API call.
 * Returns results in the same order as the input array.
 */
export async function gradeAnswerBatch(
  client: OpenJevClient,
  queries: readonly RAGQuery[],
  concurrency = 20,
): Promise<AnswerGrade[]> {
  const results: AnswerGrade[] = new Array(queries.length);
  for (let i = 0; i < queries.length; i += concurrency) {
    const chunk = queries.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map((q) => gradeAnswer(client, q)));
    for (let j = 0; j < chunkResults.length; j++) {
      const r = chunkResults[j];
      if (r !== undefined) results[i + j] = r;
    }
  }
  return results;
}

// ---- buildGradingReport ---------------------------------------------------

export interface GradingReport {
  readonly total: number;
  readonly serveRate: number; // fraction passed
  readonly hallucinationRate: number;
  readonly retrievalFailureRate: number;
  readonly avgFaithfulness: number;
  readonly avgCompleteness: number;
  readonly avgRelevance: number;
  readonly avgConfidence: number;
  readonly byFailureMode: Readonly<Record<AnswerGrade['failureMode'], number>>;
}

/**
 * Aggregate a batch of AnswerGrade results into a summary. Use this to monitor
 * your RAG pipeline quality over time and catch retrieval degradation early.
 */
export function buildGradingReport(grades: readonly AnswerGrade[]): GradingReport {
  if (grades.length === 0) {
    const zero: Record<AnswerGrade['failureMode'], number> = {
      none: 0,
      grounding: 0,
      retrieval: 0,
      relevance: 0,
      confidence: 0,
    };
    return {
      total: 0,
      serveRate: 0,
      hallucinationRate: 0,
      retrievalFailureRate: 0,
      avgFaithfulness: 0,
      avgCompleteness: 0,
      avgRelevance: 0,
      avgConfidence: 0,
      byFailureMode: zero,
    };
  }

  let served = 0;
  let hallucinated = 0;
  let retrievalFailed = 0;
  let sumFaith = 0;
  let sumComp = 0;
  let sumRel = 0;
  let sumConf = 0;
  const byFailureMode: Record<AnswerGrade['failureMode'], number> = {
    none: 0,
    grounding: 0,
    retrieval: 0,
    relevance: 0,
    confidence: 0,
  };

  for (const g of grades) {
    if (g.shouldServe) served++;
    if (g.hallucination) hallucinated++;
    if (g.retrievalInsufficient) retrievalFailed++;
    sumFaith += g.faithfulness;
    sumComp += g.completeness;
    sumRel += g.relevance;
    sumConf += g.confidence;
    byFailureMode[g.failureMode] = (byFailureMode[g.failureMode] ?? 0) + 1;
  }

  const n = grades.length;
  return {
    total: n,
    serveRate: served / n,
    hallucinationRate: hallucinated / n,
    retrievalFailureRate: retrievalFailed / n,
    avgFaithfulness: sumFaith / n,
    avgCompleteness: sumComp / n,
    avgRelevance: sumRel / n,
    avgConfidence: sumConf / n,
    byFailureMode,
  };
}

export { OpenJevClient };
/** @deprecated Use {@link OpenJevClient} instead. */
export { OpenJevClient as TypeSafeClient };
