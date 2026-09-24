import { createFileRoute } from "@tanstack/react-router";
import { MODEL_CARDS } from "@/lib/jev/models";

type ValidationError = {
  path: string;
  message: string;
};

type ValidateResponse = {
  valid: boolean;
  errors: ValidationError[];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/**
 * Collect ALL validation errors for a System One request payload without
 * throwing. This mirrors the logic of validate.ts `validateRequest` but
 * accumulates errors rather than short-circuiting on the first failure, so
 * callers receive the complete list in one round-trip.
 */
function validatePayload(input: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isPlainObject(input)) {
    errors.push({ path: "body", message: "Body must be a JSON object." });
    return errors;
  }

  // model — optional; when present must be a known catalog id
  if (input.model !== undefined && input.model !== null) {
    if (typeof input.model !== "string") {
      errors.push({ path: "model", message: "`model` must be a string." });
    } else {
      const knownIds = MODEL_CARDS.map((c) => c.id);
      if (!knownIds.includes(input.model)) {
        errors.push({
          path: "model",
          message: `Unknown model "${input.model}". Known model ids: ${knownIds.join(", ")}.`,
        });
      }
    }
  }

  // state — required, string | object | array
  if (input.state === undefined || input.state === null) {
    errors.push({ path: "state", message: "`state` is required." });
  } else if (
    typeof input.state !== "string" &&
    !isPlainObject(input.state) &&
    !Array.isArray(input.state)
  ) {
    errors.push({
      path: "state",
      message: "`state` must be a string, object, or array.",
    });
  }

  // questions — required map
  if (!isPlainObject(input.questions)) {
    errors.push({
      path: "questions",
      message: "`questions` must be a non-null object (map of named questions).",
    });
    return errors;
  }

  const entries = Object.entries(input.questions);
  if (entries.length === 0) {
    errors.push({
      path: "questions",
      message: "At least one question is required.",
    });
    return errors;
  }
  if (entries.length > 64) {
    errors.push({
      path: "questions",
      message: `At most 64 questions per request (got ${entries.length}).`,
    });
  }

  for (const [id, raw] of entries) {
    const pfx = `questions.${id}`;

    if (!isPlainObject(raw)) {
      errors.push({ path: pfx, message: "Question must be a JSON object." });
      continue;
    }

    // instructions — required, non-empty
    if (isEmpty(raw.instructions)) {
      errors.push({
        path: `${pfx}.instructions`,
        message: "Question instructions are required and must be non-empty.",
      });
    }

    const qtype = raw.type;

    if (qtype !== "noul" && qtype !== "choice" && qtype !== "score") {
      errors.push({
        path: `${pfx}.type`,
        message: `Question type must be "noul", "choice", or "score" (got ${JSON.stringify(qtype)}).`,
      });
      // No further type-specific checks without a valid type.
      continue;
    }

    if (qtype === "choice") {
      if (!isPlainObject(raw.criteria)) {
        errors.push({
          path: `${pfx}.criteria`,
          message:
            'Choice question requires a criteria object mapping option keys to descriptions.',
        });
      } else {
        const keys = Object.keys(raw.criteria);
        if (keys.length < 2) {
          errors.push({
            path: `${pfx}.criteria`,
            message: `Choice question requires at least 2 options (got ${keys.length}).`,
          });
        }
        if (keys.length > 255) {
          errors.push({
            path: `${pfx}.criteria`,
            message: `Choice question supports at most 255 options (got ${keys.length}).`,
          });
        }
      }
    }

    if (qtype === "score") {
      if (!Array.isArray(raw.criteria)) {
        errors.push({
          path: `${pfx}.criteria`,
          message: "Score question requires criteria to be an ordered array of levels.",
        });
      } else if (raw.criteria.length < 2) {
        errors.push({
          path: `${pfx}.criteria`,
          message: `Score question requires at least 2 levels (got ${raw.criteria.length}).`,
        });
      } else if (raw.criteria.length > 10) {
        errors.push({
          path: `${pfx}.criteria`,
          message: `Score question supports at most 10 levels (got ${raw.criteria.length}).`,
        });
      }
    }

    if (qtype === "noul" && raw.criteria !== undefined) {
      if (!isPlainObject(raw.criteria)) {
        errors.push({
          path: `${pfx}.criteria`,
          message:
            'Noul criteria, when present, must be an object with optional "true" and/or "false" keys.',
        });
      }
    }
  }

  return errors;
}

/**
 * POST /api/v1/validate
 *
 * Dry-run schema validation for a System One request payload. Returns
 * { valid, errors[] } without running the engine. Useful for editor tooling,
 * SDK pre-flight checks, and CI pipelines that want to catch malformed payloads
 * before incurring decision latency or quota.
 *
 * Checks performed:
 *   - state is present and a string | object | array
 *   - questions is a non-empty map (max 64)
 *   - each question has a non-empty instructions field
 *   - question type is "noul" | "choice" | "score"
 *   - choice: criteria is an object with >=2 options (max 255)
 *   - score: criteria is an array with 2–10 levels
 *   - noul: criteria, when present, is an object
 *   - model, when present, is a known catalog id
 *
 * A 422 status accompanies an invalid payload; 200 accompanies a valid one.
 */
export const Route = createFileRoute("/api/v1/validate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            {
              error: {
                type: "invalid_request",
                message: "Request body must be valid JSON.",
              },
            },
            { status: 400 },
          );
        }

        const errors = validatePayload(body);
        const valid = errors.length === 0;
        const response: ValidateResponse = { valid, errors };
        return Response.json(response, { status: valid ? 200 : 422 });
      },

      GET: async () =>
        Response.json({
          name: "openjev validate",
          description:
            "Validate a System One request payload without executing it. " +
            "Returns { valid: bool, errors: [{ path, message }] }.",
          endpoint: "POST /api/v1/validate",
          checks: [
            "state present and string | object | array",
            "questions non-empty map (max 64 entries)",
            "each question: instructions non-empty",
            "each question: type is noul | choice | score",
            "choice: criteria object with >=2 options (max 255)",
            "score: criteria array with 2-10 levels",
            "noul: criteria shape when present",
            "model (optional): known catalog id",
          ],
        }),
    },
  },
});
