/**
 * Serve a System One request on the embedding engine. Returns null when the
 * encoder is not installed (the caller then serves the lexical engine and
 * reports `engine: { kind: "lexical", reason }`).
 */
import { lexicalAnswers } from "../engine.ts";
import { applyScope } from "../scope.ts";
import {
  approxTokens,
  stateProse,
  LOCAL_MODEL,
  type Answer,
  type SystemOneRequest,
  type SystemOneResponse,
} from "../types.ts";
import { flattenEntry } from "../entry.ts";
import { embedCapability, embedTexts, type EmbedCapability } from "./encoder.server.ts";
import { embedEngineVersion } from "./params.ts";
import {
  answerQuestion,
  embedStateText,
  EMBED_PARAMS,
  type EmbedFn,
  type EmbedParams,
} from "./engine.ts";

export type RunEmbedOptions = {
  params?: EmbedParams;
  embed?: EmbedFn;
  /** Skip the capability check (tests with an injected encoder). */
  capability?: EmbedCapability;
};

export async function runEmbed(
  req: SystemOneRequest,
  opts: RunEmbedOptions = {},
): Promise<SystemOneResponse | null> {
  const cap = opts.capability ?? (await embedCapability());
  if (!cap.available) return null;
  const embed = opts.embed ?? embedTexts;
  const params = opts.params ?? EMBED_PARAMS;
  const t0 = performance.now();
  const lexical = lexicalAnswers(req, LOCAL_MODEL);
  const answers: Record<string, Answer> = {};
  const ood: Record<string, number> = {};
  for (const [id, q] of Object.entries(req.questions)) {
    const text = embedStateText(req.state, q);
    const [x] = await embed([text || " "], "query");
    const out = await answerQuestion(q, {
      x: x!,
      stateText: text,
      embed,
      params,
      lexical: lexical[id],
    });
    answers[id] = out.answer;
    ood[id] = out.ood;
  }
  const scoped = applyScope(req, answers, { damp: true, ood });
  const qText = Object.values(req.questions)
    .map((q) => flattenEntry(q.instructions).text)
    .join(" ");
  return {
    model: LOCAL_MODEL,
    engine: { kind: "embedding", encoder: cap.model, version: embedEngineVersion(cap.model) },
    answers: scoped,
    usage: {
      input_tokens: approxTokens(stateProse(req.state) + " " + qText),
      output_tokens: approxTokens(JSON.stringify(scoped)),
    },
    latency_ms: Math.max(0, Math.round((performance.now() - t0) * 10) / 10),
  };
}
