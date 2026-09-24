import { Link, useLocation } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

/**
 * Shared 404 body for content detail routes. Routes throw `notFound()` from
 * their loader for unknown slugs, so SSR answers with HTTP 404 (not a soft
 * 200) and this component renders inside the normal site chrome.
 */
export interface ContentNotFoundProps {
  kind: string;
  backTo: string;
  backLabel: string;
}

export function ContentNotFound({ kind, backTo, backLabel }: ContentNotFoundProps) {
  const path = useLocation({ select: (l) => l.pathname });
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-4 py-8">
        <h1 className="text-2xl font-medium tracking-tight">{kind} not found</h1>
        <p className="text-sm text-muted">
          Nothing is published at <span className="font-mono text-fg">{path}</span>.
        </p>
        <Link to={backTo} className="inline-block text-sm text-fg underline-offset-4 hover:underline">
          {backLabel}
        </Link>
      </div>
    </AppShell>
  );
}
