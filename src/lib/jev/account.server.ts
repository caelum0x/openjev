import { getSql } from "@/lib/db";

/**
 * DB-backed, user-scoped account settings (Foundation-2). Profile identity
 * (email / real name) lives in the Better Auth `"user"` table; this module owns
 * the console's display overrides and org-display fields (`account_settings`).
 * Scoped to a server-resolved `userId`.
 */

export type AccountTheme = "system" | "light" | "dark";

export type AccountProfile = {
  user_id: string;
  email: string | null; // from the auth `"user"` table (best-effort)
  name: string | null; // real name from the auth `"user"` table
  display_name: string | null; // console override
  org_name: string | null;
  org_slug: string | null;
  timezone: string | null;
  theme: AccountTheme;
  email_digest: boolean;
  updated_at: number | null; // epoch millis, null until first saved
};

/** Patch for `updateAccount`. Any omitted field is left unchanged. */
export type UpdateAccountInput = {
  display_name?: string | null;
  org_name?: string | null;
  org_slug?: string | null;
  timezone?: string | null;
  theme?: AccountTheme;
  email_digest?: boolean;
};

const THEMES: readonly AccountTheme[] = ["system", "light", "dark"];

function normalizeTheme(value: unknown): AccountTheme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value)
    ? (value as AccountTheme)
    : "system";
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

type SettingsRow = {
  display_name: string | null;
  org_name: string | null;
  org_slug: string | null;
  timezone: string | null;
  theme: string;
  email_digest: boolean;
  updated_at: number | null;
};

const SETTINGS_COLS = `
  display_name, org_name, org_slug, timezone, theme, email_digest,
  (extract(epoch from updated_at) * 1000)::bigint as updated_at`;

/**
 * Best-effort read of the auth identity. The `"user"` table only exists when
 * Better Auth is configured (the auth migration is opt-in and not applied to the
 * preview PGLite fallback), so a missing table resolves to nulls.
 */
async function readIdentity(
  userId: string,
): Promise<{ email: string | null; name: string | null }> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ email: string | null; name: string | null }>(
      `select email, name from "user" where id = $1`,
      [userId],
    );
    return rows[0] ?? { email: null, name: null };
  } catch {
    return { email: null, name: null };
  }
}

async function readSettings(userId: string): Promise<SettingsRow | null> {
  const sql = await getSql();
  const rows = await sql.query<SettingsRow>(
    `select ${SETTINGS_COLS} from account_settings where user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

function toProfile(
  userId: string,
  identity: { email: string | null; name: string | null },
  settings: SettingsRow | null,
): AccountProfile {
  return {
    user_id: userId,
    email: identity.email,
    name: identity.name,
    display_name: settings?.display_name ?? null,
    org_name: settings?.org_name ?? null,
    org_slug: settings?.org_slug ?? null,
    timezone: settings?.timezone ?? null,
    theme: normalizeTheme(settings?.theme),
    email_digest: settings?.email_digest ?? false,
    updated_at: settings?.updated_at ?? null,
  };
}

/** The account profile for `userId` (auth identity + console settings). */
export async function getAccount(userId: string): Promise<AccountProfile> {
  const [identity, settings] = await Promise.all([
    readIdentity(userId),
    readSettings(userId),
  ]);
  return toProfile(userId, identity, settings);
}

/** Upsert the console settings for `userId`, then return the full profile. */
export async function updateAccount(
  userId: string,
  patch: UpdateAccountInput,
): Promise<AccountProfile> {
  const current = await readSettings(userId);

  const display_name =
    patch.display_name !== undefined
      ? patch.display_name?.trim() || null
      : (current?.display_name ?? null);
  const org_name =
    patch.org_name !== undefined
      ? patch.org_name?.trim() || null
      : (current?.org_name ?? null);
  const org_slug =
    patch.org_slug !== undefined
      ? patch.org_slug
        ? slugify(patch.org_slug)
        : null
      : (current?.org_slug ?? null);
  const timezone =
    patch.timezone !== undefined
      ? patch.timezone?.trim() || null
      : (current?.timezone ?? null);
  const theme =
    patch.theme !== undefined ? normalizeTheme(patch.theme) : normalizeTheme(current?.theme);
  const email_digest =
    typeof patch.email_digest === "boolean"
      ? patch.email_digest
      : (current?.email_digest ?? false);

  const sql = await getSql();
  await sql.query(
    `insert into account_settings
       (user_id, display_name, org_name, org_slug, timezone, theme, email_digest, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (user_id) do update set
       display_name = excluded.display_name,
       org_name     = excluded.org_name,
       org_slug     = excluded.org_slug,
       timezone     = excluded.timezone,
       theme        = excluded.theme,
       email_digest = excluded.email_digest,
       updated_at   = now()`,
    [userId, display_name, org_name, org_slug, timezone, theme, email_digest],
  );

  const identity = await readIdentity(userId);
  const settings = await readSettings(userId);
  return toProfile(userId, identity, settings);
}
