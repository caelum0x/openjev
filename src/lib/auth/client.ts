import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for the console (browser-side). Talks to this app's own
 * Better Auth at same-origin `/api/auth/*`; the session rides an HttpOnly
 * cookie, so nothing is stored client-side.
 */
export const authClient = createAuthClient();

/**
 * True when sign-in is enforced. Mirrors the server's `authConfigured`: auth is
 * opt-in via `VITE_AUTH_ENABLED=true`; otherwise the console runs keyless as
 * the local dev user (see `use-current-user`).
 */
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED === "true";

/** Where signed-out visitors are sent to authenticate. */
export const SIGN_IN_PATH = "/login";

/** Sign in with an email/password account. Throws with a readable message. */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await authClient.signIn.email({ email, password });
  if (error) throw new Error(error.message ?? "Sign-in failed");
}

/** Create an email/password account (and sign it in). */
export async function signUpWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<void> {
  const { error } = await authClient.signUp.email({ name, email, password });
  if (error) throw new Error(error.message ?? "Sign-up failed");
}

/**
 * Sign out of the local session, then redirect. Rejects if the server never
 * confirms — the session is an HttpOnly cookie only the server can clear, so
 * redirecting anyway would report a sign-out that did not happen.
 */
export async function signOut(redirectTo = "/"): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "Sign-out failed");
  window.location.href = redirectTo;
}
