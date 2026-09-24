import { useState, type ReactNode } from "react";
import { Link, Navigate } from "@tanstack/react-router";
import { SIGN_IN_PATH, authEnabled, signOut } from "./client";
import { resolveSignInGateState } from "./sign-in-gate";
import { useCurrentUserState } from "./use-current-user";

/**
 * Auth state components — thin wrappers around `useCurrentUserState()`.
 *
 * With auth on (`VITE_AUTH_ENABLED=true`) visitors are signed out until they
 * authenticate at `/login`. With auth off every visitor is the local dev user.
 * While the session is still resolving, gates that care about signed-out state
 * render nothing so there's no signed-out flash on hard reload.
 */

/** Render children only when a user is present (real session or dev user). */
export function SignedIn({ children }: { children: ReactNode }) {
  const { user } = useCurrentUserState();
  return user ? <>{children}</> : null;
}

/** Render children only once we KNOW the visitor is signed out. */
export function SignedOut({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending || user) return null;
  return <>{children}</>;
}

/** Client-side redirect to the sign-in route (no full reload). */
export function RedirectToSignIn({ to = SIGN_IN_PATH }: { to?: string }) {
  return <Navigate to={to} />;
}

/** Render children when signed in, otherwise `fallback` (default: a sign-in link). */
export function SignInGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user, isPending } = useCurrentUserState();
  const state = resolveSignInGateState({ isPending, hasUser: user !== null });
  if (state === "pending") return null;
  if (state === "signed_in") return <>{children}</>;
  return (
    <>
      {fallback ?? (
        <Link to={SIGN_IN_PATH} className="text-sm underline underline-offset-4">
          Sign in
        </Link>
      )}
    </>
  );
}

/**
 * Compact identity chip for the console chrome: the signed-in email plus a
 * sign-out control, a sign-in link when signed out, or a "local mode" label
 * when auth is disabled.
 */
export function UserButton() {
  const { user, isPending } = useCurrentUserState();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authEnabled) {
    return <span className="font-mono text-[10px] text-subtle">local mode · auth off</span>;
  }
  if (isPending) return null;
  if (!user) {
    return (
      <Link to={SIGN_IN_PATH} className="text-xs text-muted underline-offset-4 hover:text-fg hover:underline">
        Sign in
      </Link>
    );
  }
  const label = user.displayName ?? user.primaryEmail ?? "Account";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate text-xs text-muted" title={user.primaryEmail ?? undefined}>
        {label}
      </span>
      <button
        type="button"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          setError(null);
          // Success navigates away; on failure re-enable so it can be retried.
          void signOut().catch((err: unknown) => {
            setSigningOut(false);
            setError(err instanceof Error ? err.message : "Sign-out failed");
          });
        }}
        className="cursor-pointer text-xs text-subtle underline-offset-4 hover:text-fg hover:underline disabled:cursor-wait"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
      {error ? <span className="text-xs text-red-500">{error}</span> : null}
    </div>
  );
}
