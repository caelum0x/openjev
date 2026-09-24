import type { SystemOneRequest, SystemOneResponse } from "./types";

const ENGINE_URL = process.env.OPENJEV_ENGINE_URL ?? process.env.OPENTYPESAFE_ENGINE_URL ?? "http://127.0.0.1:8091";

export function engineUrl(): string {
  return ENGINE_URL.replace(/\/$/, "");
}

export async function nativeHealth(): Promise<{ ok: boolean; engine?: string }> {
  try {
    const res = await fetch(`${engineUrl()}/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; engine?: string };
  } catch {
    return { ok: false };
  }
}

export async function runNative(
  req: SystemOneRequest,
): Promise<SystemOneResponse | null> {
  try {
    const res = await fetch(`${engineUrl()}/v1/systemone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SystemOneResponse;
    if (!body || typeof body !== "object" || !body.answers) return null;
    return body;
  } catch {
    return null;
  }
}
