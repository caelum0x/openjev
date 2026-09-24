/**
 * How a cookbook answers its typed questions. The API routes pass the server's
 * real serving path (`serveSystemOne`), so cookbooks run on the same engine as
 * POST /api/v1/systemone (the sentence-embedding engine when installed). Unit
 * tests and offline scripts use the deterministic in-process lexical engine.
 */
import { runLocal } from "../engine.ts";
import { LOCAL_MODEL, type SystemOneRequest, type SystemOneResponse } from "../types.ts";

export type Evaluator = (req: SystemOneRequest) => Promise<SystemOneResponse>;

export const lexicalEvaluator: Evaluator = async (req) =>
  runLocal(req, req.model ?? LOCAL_MODEL);
