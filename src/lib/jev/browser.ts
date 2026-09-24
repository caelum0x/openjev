const KEY = "openjev_active_key";
/** Pre-rename storage key, still read so existing browser sessions keep their key. */
const LEGACY_KEY = "opentypesafe_active_key";

export function getActiveKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
}

export function setActiveKey(secret: string | null) {
  if (typeof localStorage === "undefined") return;
  if (secret) localStorage.setItem(KEY, secret);
  else {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  const key = getActiveKey();
  if (key) headers.set("Authorization", `Bearer ${key}`);
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = body as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}
