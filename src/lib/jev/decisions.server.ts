import { getSql } from "@/lib/db";
import { executeSystemOne } from "./run";
import type { Questions, State, SystemOneResponse } from "./types";

/**
 * DB-backed, user-scoped saved decisions (Foundation-2). A saved decision is a
 * named, versioned System One schema (a `state` + `questions` pair) the user can
 * re-run from the console. `runDecision` executes it against the real engine via
 * `executeSystemOne`. Every read/write is scoped to a server-resolved `userId`.
 */

/** A saved decision as returned to the console. Timestamps are epoch millis. */
export type SavedDecision = {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  state: State;
  questions: Questions;
  version: number;
  created_at: number;
  updated_at: number;
};

/** Input to `createDecision`. `state`/`questions` are the System One shapes. */
export type CreateDecisionInput = {
  name: string;
  description?: string | null;
  projectId?: string | null;
  state: State;
  questions: Questions;
};

/** Partial update. Any omitted field is left unchanged; `version` auto-bumps. */
export type UpdateDecisionInput = {
  name?: string;
  description?: string | null;
  projectId?: string | null;
  state?: State;
  questions?: Questions;
};

type DecisionRow = {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  state: unknown;
  questions: unknown;
  version: number;
  created_at: number;
  updated_at: number;
};

const PUBLIC_COLS = `
  id, project_id, name, description,
  state_json as state, questions_json as questions, version,
  (extract(epoch from created_at) * 1000)::bigint as created_at,
  (extract(epoch from updated_at) * 1000)::bigint as updated_at`;

function suffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

// jsonb comes back parsed on both drivers, but tolerate a text fallback.
function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function toDecision(row: DecisionRow): SavedDecision {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    description: row.description,
    state: parseJson<State>(row.state, ""),
    questions: parseJson<Questions>(row.questions, {}),
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Create a saved decision for `userId`. */
export async function createDecision(
  userId: string,
  input: CreateDecisionInput,
): Promise<SavedDecision> {
  const sql = await getSql();
  const id = `dec_${Date.now().toString(36)}${suffix()}`;
  const rows = await sql.query<DecisionRow>(
    `insert into saved_decisions
       (id, user_id, project_id, name, description, state_json, questions_json)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     returning ${PUBLIC_COLS}`,
    [
      id,
      userId,
      input.projectId ?? null,
      input.name.trim() || "Untitled decision",
      input.description ?? null,
      JSON.stringify(input.state ?? ""),
      JSON.stringify(input.questions ?? {}),
    ],
  );
  return toDecision(rows[0]);
}

/** A user's saved decisions, newest first. Optionally filtered by project. */
export async function listDecisions(
  userId: string,
  opts?: { projectId?: string | null },
): Promise<SavedDecision[]> {
  const sql = await getSql();
  const byProject = opts?.projectId !== undefined && opts.projectId !== null;
  const rows = await sql.query<DecisionRow>(
    `select ${PUBLIC_COLS} from saved_decisions
     where user_id = $1 ${byProject ? "and project_id = $2" : ""}
     order by created_at desc`,
    byProject ? [userId, opts?.projectId] : [userId],
  );
  return rows.map(toDecision);
}

/** One saved decision by id (scoped to the user), or null. */
export async function getDecision(
  userId: string,
  id: string,
): Promise<SavedDecision | null> {
  const sql = await getSql();
  const rows = await sql.query<DecisionRow>(
    `select ${PUBLIC_COLS} from saved_decisions where id = $1 and user_id = $2`,
    [id, userId],
  );
  return rows[0] ? toDecision(rows[0]) : null;
}

/** Update a saved decision (partial). Bumps `version` and `updated_at`. */
export async function updateDecision(
  userId: string,
  id: string,
  patch: UpdateDecisionInput,
): Promise<SavedDecision | null> {
  const current = await getDecision(userId, id);
  if (!current) return null;

  const merged = {
    name:
      typeof patch.name === "string" && patch.name.trim()
        ? patch.name.trim()
        : current.name,
    description:
      patch.description !== undefined ? patch.description : current.description,
    project_id: patch.projectId !== undefined ? patch.projectId : current.project_id,
    state: patch.state !== undefined ? patch.state : current.state,
    questions: patch.questions !== undefined ? patch.questions : current.questions,
    version: current.version + 1,
  };

  const sql = await getSql();
  const rows = await sql.query<DecisionRow>(
    `update saved_decisions set
       name = $3, description = $4, project_id = $5,
       state_json = $6::jsonb, questions_json = $7::jsonb,
       version = $8, updated_at = now()
     where id = $1 and user_id = $2
     returning ${PUBLIC_COLS}`,
    [
      id,
      userId,
      merged.name,
      merged.description,
      merged.project_id,
      JSON.stringify(merged.state ?? ""),
      JSON.stringify(merged.questions ?? {}),
      merged.version,
    ],
  );
  return rows[0] ? toDecision(rows[0]) : null;
}

/** Hard-delete a saved decision (scoped to the user). True if a row was removed. */
export async function deleteDecision(userId: string, id: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `delete from saved_decisions where id = $1 and user_id = $2 returning id`,
    [id, userId],
  );
  return rows.length > 0;
}

/** The result of running a saved decision through the real engine. */
export type RunDecisionResult = {
  decisionId: string;
  version: number;
  model: string;
  response: SystemOneResponse;
};

/**
 * Run a saved decision against the real System One engine. Uses the decision's
 * stored `questions`, and its stored `state` unless `opts.state` overrides it.
 * `opts.model` picks the model/backend (defaults to the flagship `system-one`).
 * Returns null when the decision doesn't exist for this user.
 *
 * `executeSystemOne` records a usage_events + activity_log row for the call,
 * attributed to the session user (best-effort).
 */
export async function runDecision(
  userId: string,
  id: string,
  opts?: { model?: string; state?: State },
): Promise<RunDecisionResult | null> {
  const decision = await getDecision(userId, id);
  if (!decision) return null;

  const model = opts?.model?.trim() || "system-one";
  const response = await executeSystemOne(
    {
      model,
      state: opts?.state !== undefined ? opts.state : decision.state,
      questions: decision.questions,
    },
    { path: "/api/v1/decisions#run" },
  );

  return {
    decisionId: decision.id,
    version: decision.version,
    model: response.model,
    response,
  };
}
