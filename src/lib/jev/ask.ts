import { createServerFn } from "@tanstack/react-start";
import { executeSystemOne } from "./run";
import { llmAvailable } from "./llm.server";
import { JevValidationError } from "./validate";
import type { SystemOneResponse } from "./types";
import { MODEL_CARDS } from "./models";

export const askSystemOne = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<SystemOneResponse> => {
    return executeSystemOne(data, { path: "askSystemOne" });
  });

export const grokStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ available: boolean }> => {
    return { available: llmAvailable() };
  },
);

export const listModelsFn = createServerFn({ method: "GET" }).handler(
  async () => MODEL_CARDS,
);

export function errorPayload(err: unknown) {
  if (err instanceof JevValidationError) {
    return { error: { type: err.type, message: err.message } };
  }
  const message = err instanceof Error ? err.message : "Internal error";
  return { error: { type: "internal", message } };
}
