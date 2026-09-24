import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authEnabled, signInWithEmail, signUpWithEmail } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — OpenJev" }] }),
  component: LoginPage,
});

type Mode = "sign-in" | "sign-up";

const MIN_PASSWORD_LENGTH = 8;

function LoginPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-sm py-10">
        {authEnabled ? <LoginForm /> : <AuthDisabledNotice />}
      </div>
    </AppShell>
  );
}

function AuthDisabledNotice() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-medium tracking-tight">Sign-in is off</h1>
      <p className="text-sm text-muted">
        This instance runs in local mode: every console request acts as the local dev user. To
        require accounts, set <span className="font-mono text-fg">VITE_AUTH_ENABLED=true</span>{" "}
        and <span className="font-mono text-fg">BETTER_AUTH_SECRET</span>, then restart.
      </p>
      <Link to="/self-hosting" className="text-sm underline underline-offset-4">
        Self-hosting guide
      </Link>
    </div>
  );
}

function LoginForm() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isPending) return null;
  if (user) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-medium tracking-tight">You're signed in</h1>
        <p className="text-sm text-muted">{user.primaryEmail}</p>
        <Link to="/dashboard" className="text-sm underline underline-offset-4">
          Go to the dashboard
        </Link>
      </div>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes("@")) return setError("Enter a valid email address.");
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (mode === "sign-up" && !name.trim()) return setError("Enter your name.");
    setBusy(true);
    try {
      if (mode === "sign-in") await signInWithEmail(trimmedEmail, password);
      else await signUpWithEmail(name.trim(), trimmedEmail, password);
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const isSignUp = mode === "sign-up";
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1">
        <h1 className="text-xl font-medium tracking-tight">
          {isSignUp ? "Create an account" : "Sign in"}
        </h1>
        <p className="text-sm text-muted">
          {isSignUp ? "Accounts are stored in this instance's database." : "Use your email and password."}
        </p>
      </div>
      {isSignUp ? (
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
      ) : null}
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Email</span>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Password</span>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isSignUp ? "new-password" : "current-password"}
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Working…" : isSignUp ? "Create account" : "Sign in"}
      </Button>
      <button
        type="button"
        className="w-full cursor-pointer text-center text-xs text-muted underline-offset-4 hover:text-fg hover:underline"
        onClick={() => {
          setMode(isSignUp ? "sign-in" : "sign-up");
          setError(null);
        }}
      >
        {isSignUp ? "Have an account? Sign in" : "No account yet? Create one"}
      </button>
    </form>
  );
}
