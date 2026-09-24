import type {
  EntryType,
  Question,
  QuestionExtensions,
  Questions,
  State,
  SystemOneRequest,
} from "./types.ts";

/** Reserved "none of the above" option key (kept in sync with scope.ts). */
const NONE_OPTION = "__none__";

export class JevValidationError extends Error {
  type: string;
  constructor(type: string, message: string) {
    super(message);
    this.type = type;
    this.name = "JevValidationError";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isEmptyEntry(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return !v.trim();
  if (typeof v === "number" || typeof v === "boolean") return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return true;
}

function asEntry(v: unknown): EntryType {
  return v as EntryType;
}

export function validateRequest(input: unknown): SystemOneRequest {
  if (!isPlainObject(input)) {
    throw new JevValidationError("invalid_request", "Body must be a JSON object.");
  }
  if (input.state === undefined || input.state === null) {
    throw new JevValidationError("invalid_request", "`state` is required.");
  }
  const state = input.state as State;
  if (
    typeof state !== "string" &&
    !isPlainObject(state) &&
    !Array.isArray(state)
  ) {
    throw new JevValidationError(
      "invalid_request",
      "`state` must be a string, object, or array.",
    );
  }
  if (!isPlainObject(input.questions)) {
    throw new JevValidationError(
      "invalid_request",
      "`questions` must be a map of named questions.",
    );
  }
  const questions: Questions = {};
  const entries = Object.entries(input.questions);
  if (entries.length === 0) {
    throw new JevValidationError("invalid_request", "Ask at least one question.");
  }
  if (entries.length > 64) {
    throw new JevValidationError(
      "invalid_request",
      "At most 64 questions per request.",
    );
  }
  for (const [id, raw] of entries) {
    questions[id] = validateQuestion(id, raw);
  }
  const model = typeof input.model === "string" ? input.model : undefined;
  const out: SystemOneRequest = { model, state, questions };
  if (input.abstain !== undefined) out.abstain = asBool("abstain", input.abstain);
  if (input.abstain_below !== undefined) {
    out.abstain_below = asUnit("abstain_below", input.abstain_below);
  }
  if (input.escalate_below !== undefined) {
    out.escalate_below = asUnit("escalate_below", input.escalate_below);
  }
  if (input.calibration_id !== undefined) {
    if (typeof input.calibration_id !== "string" || !/^cal_[a-z0-9]{4,40}$/.test(input.calibration_id)) {
      throw new JevValidationError(
        "invalid_request",
        "`calibration_id` must be a calibration id like `cal_…`.",
      );
    }
    out.calibration_id = input.calibration_id;
  }
  return out;
}

function asBool(field: string, v: unknown): boolean {
  if (typeof v !== "boolean") {
    throw new JevValidationError("invalid_request", `\`${field}\` must be a boolean.`);
  }
  return v;
}

function asUnit(field: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new JevValidationError(
      "invalid_request",
      `\`${field}\` must be a number between 0 and 1.`,
    );
  }
  return v;
}

/** Validate the optional trust extensions every question type accepts. */
function questionExtensions(id: string, raw: Record<string, unknown>): QuestionExtensions {
  const ext: QuestionExtensions = {};
  if (raw.abstain !== undefined) ext.abstain = asBool(`questions.${id}.abstain`, raw.abstain);
  if (raw.abstain_below !== undefined) {
    ext.abstain_below = asUnit(`questions.${id}.abstain_below`, raw.abstain_below);
  }
  if (raw.escalate_below !== undefined) {
    ext.escalate_below = asUnit(`questions.${id}.escalate_below`, raw.escalate_below);
  }
  return ext;
}

function validateQuestion(id: string, raw: unknown): Question {
  if (!isPlainObject(raw)) {
    throw new JevValidationError(
      "invalid_question",
      `Question "${id}" must be an object.`,
    );
  }
  const type = raw.type;
  if (isEmptyEntry(raw.instructions)) {
    throw new JevValidationError(
      "invalid_question",
      `Question "${id}" needs instructions.`,
    );
  }
  const instructions = asEntry(raw.instructions);
  const ext = questionExtensions(id, raw);
  if (type === "noul") {
    let criteria: { true?: EntryType; false?: EntryType } | undefined;
    if (raw.criteria !== undefined) {
      if (!isPlainObject(raw.criteria)) {
        throw new JevValidationError(
          "invalid_question",
          `Noul "${id}" criteria must be { true, false }.`,
        );
      }
      criteria = {
        true: raw.criteria.true == null ? null : asEntry(raw.criteria.true),
        false: raw.criteria.false == null ? null : asEntry(raw.criteria.false),
      };
    }
    return { type: "noul", instructions, criteria, ...ext };
  }
  if (type === "choice") {
    if (!isPlainObject(raw.criteria)) {
      throw new JevValidationError(
        "invalid_question",
        `Choice "${id}" needs a criteria map of options.`,
      );
    }
    const criteria: Record<string, EntryType> = {};
    const keys = Object.keys(raw.criteria);
    if (keys.length < 2) {
      throw new JevValidationError(
        "invalid_question",
        `Choice "${id}" needs at least 2 options.`,
      );
    }
    if (keys.length > 255) {
      throw new JevValidationError(
        "invalid_question",
        `Choice "${id}" supports at most 255 options.`,
      );
    }
    for (const k of keys) {
      if (k === NONE_OPTION) {
        throw new JevValidationError(
          "invalid_question",
          `Choice "${id}" cannot use the reserved option key "${NONE_OPTION}" (set \`abstain: true\` instead).`,
        );
      }
      criteria[k] = raw.criteria[k] == null ? null : asEntry(raw.criteria[k]);
    }
    return { type: "choice", instructions, criteria, ...ext };
  }
  if (type === "score") {
    if (!Array.isArray(raw.criteria)) {
      throw new JevValidationError(
        "invalid_question",
        `Score "${id}" needs an ordered array of levels.`,
      );
    }
    if (raw.criteria.length < 2 || raw.criteria.length > 10) {
      throw new JevValidationError(
        "invalid_question",
        `Score "${id}" needs 2–10 levels.`,
      );
    }
    const criteria = raw.criteria.map((c) => asEntry(c));
    return { type: "score", instructions, criteria, ...ext };
  }
  throw new JevValidationError(
    "invalid_question",
    `Question "${id}" type must be noul, choice, or score.`,
  );
}
