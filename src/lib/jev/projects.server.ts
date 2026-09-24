import { getSql } from "@/lib/db";

/**
 * DB-backed, user-scoped projects (Foundation-2). A project is an optional
 * grouping for API keys and usage. Every read/write is scoped to a `userId`
 * resolved server-side (see src/lib/auth/verify.server.ts). Builds on the
 * `projects` table from migrations/0002_console.sql.
 */

/** Public project row (epoch-ms timestamps, no `user_id` on the wire). */
export type Project = {
  id: string;
  name: string;
  slug: string;
  created_at: number; // epoch millis
  archived_at: number | null; // epoch millis (null while active)
};

/** Rolled-up activity for one project. */
export type ProjectStats = {
  keys: number; // active (non-revoked) keys assigned to the project
  calls_24h: number;
  calls_total: number;
  tokens_total: number;
  last_used_at: number | null; // epoch millis of the most recent metered call
};

export type ProjectWithStats = Project & { stats: ProjectStats };

const PUBLIC_COLS = `
  id, name, slug,
  (extract(epoch from created_at) * 1000)::bigint  as created_at,
  (extract(epoch from archived_at) * 1000)::bigint as archived_at`;

const ZERO_STATS: ProjectStats = {
  keys: 0,
  calls_24h: 0,
  calls_total: 0,
  tokens_total: 0,
  last_used_at: null,
};

function suffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Normalize a name into a url-safe slug (lowercase, dash-separated). */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Pick a slug that is unique per user. Starts from `base` and appends `-2`,
 * `-3`, … until free. `excludeId` lets an update keep its own slug.
 */
async function uniqueSlug(
  userId: string,
  base: string,
  excludeId?: string,
): Promise<string> {
  const sql = await getSql();
  const root = base || "project";
  const rows = await sql.query<{ slug: string }>(
    `select slug from projects where user_id = $1 and slug like $2 and ($3::text is null or id <> $3)`,
    [userId, `${root}%`, excludeId ?? null],
  );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

/** Merge the per-project stats maps into the project rows. */
async function withStats(
  userId: string,
  projects: Project[],
): Promise<ProjectWithStats[]> {
  if (projects.length === 0) return [];
  const sql = await getSql();

  const usageRows = await sql.query<{
    project_id: string;
    calls_24h: number;
    calls_total: number;
    tokens_total: number;
    last_used_at: number | null;
  }>(
    `select project_id,
            count(*) filter (where ts > now() - interval '24 hours')::int as calls_24h,
            count(*)::int as calls_total,
            coalesce(sum(input_tokens + output_tokens), 0)::bigint as tokens_total,
            (extract(epoch from max(ts)) * 1000)::bigint as last_used_at
     from usage_events
     where user_id = $1 and project_id is not null
     group by project_id`,
    [userId],
  );
  const keyRows = await sql.query<{ project_id: string; keys: number }>(
    `select project_id, count(*)::int as keys
     from api_keys
     where user_id = $1 and project_id is not null and revoked_at is null
     group by project_id`,
    [userId],
  );

  const statsById = new Map<string, ProjectStats>();
  for (const r of usageRows) {
    statsById.set(r.project_id, {
      keys: 0,
      calls_24h: r.calls_24h,
      calls_total: r.calls_total,
      tokens_total: r.tokens_total,
      last_used_at: r.last_used_at,
    });
  }
  for (const r of keyRows) {
    const existing = statsById.get(r.project_id) ?? { ...ZERO_STATS };
    statsById.set(r.project_id, { ...existing, keys: r.keys });
  }

  return projects.map((p) => ({
    ...p,
    stats: statsById.get(p.id) ?? { ...ZERO_STATS },
  }));
}

/** All of a user's active projects (newest first), each with rolled-up stats. */
export async function listProjects(userId: string): Promise<ProjectWithStats[]> {
  const sql = await getSql();
  const projects = await sql.query<Project>(
    `select ${PUBLIC_COLS} from projects
     where user_id = $1 and archived_at is null
     order by created_at desc`,
    [userId],
  );
  return withStats(userId, projects);
}

/** One project by id (scoped to the user), with stats, or null. */
export async function getProject(
  userId: string,
  id: string,
): Promise<ProjectWithStats | null> {
  const sql = await getSql();
  const rows = await sql.query<Project>(
    `select ${PUBLIC_COLS} from projects where id = $1 and user_id = $2`,
    [id, userId],
  );
  if (rows.length === 0) return null;
  const [withStat] = await withStats(userId, rows);
  return withStat ?? null;
}

/** Create a project for `userId`. `slug` defaults to a slugified `name`. */
export async function createProject(
  userId: string,
  name: string,
  slug?: string,
): Promise<Project> {
  const sql = await getSql();
  const cleanName = name.trim() || "Untitled project";
  const base = slugify(slug ?? cleanName);
  const finalSlug = await uniqueSlug(userId, base);
  const id = `proj_${Date.now().toString(36)}${suffix()}`;
  const rows = await sql.query<Project>(
    `insert into projects (id, user_id, name, slug)
     values ($1, $2, $3, $4)
     returning ${PUBLIC_COLS}`,
    [id, userId, cleanName, finalSlug],
  );
  return rows[0];
}

/** Update a project's name and/or slug (scoped to the user). Null if absent. */
export async function updateProject(
  userId: string,
  id: string,
  patch: { name?: string; slug?: string },
): Promise<Project | null> {
  const sql = await getSql();
  const current = await sql.query<Project>(
    `select ${PUBLIC_COLS} from projects where id = $1 and user_id = $2`,
    [id, userId],
  );
  if (current.length === 0) return null;

  const name =
    typeof patch.name === "string" && patch.name.trim()
      ? patch.name.trim()
      : current[0].name;
  const slug =
    patch.slug !== undefined || patch.name !== undefined
      ? await uniqueSlug(userId, slugify(patch.slug ?? name), id)
      : current[0].slug;

  const rows = await sql.query<Project>(
    `update projects set name = $3, slug = $4
     where id = $1 and user_id = $2
     returning ${PUBLIC_COLS}`,
    [id, userId, name, slug],
  );
  return rows[0] ?? null;
}

/** Soft-archive a project (sets `archived_at`). Scoped to the user. */
export async function archiveProject(userId: string, id: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `update projects set archived_at = now()
     where id = $1 and user_id = $2 and archived_at is null
     returning id`,
    [id, userId],
  );
  return rows.length > 0;
}
