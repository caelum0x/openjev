import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { JsonPlayground } from "@/components/json-playground";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/playground")({
  head: () =>
    pageHead("Playground", "Try typed decisions in the browser: send state plus questions, get Choice, Score and Noul answers with probabilities."),
  component: PlayPage,
});

function PlayPage() {
  return (
    <AppShell>
      <div className="space-y-5">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Playground
          </p>
          <h1 className="text-2xl font-medium tracking-tight md:text-3xl">
            View example requests
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            JSON in, JSON out. Every run is a real POST /api/v1/systemone call,
            so it answers on the same engine your API calls use. Default model:
            system-one. Three primitives (Choice, Score, Noul) evaluated against
            one shared state.
          </p>
        </header>
        <JsonPlayground />
      </div>
    </AppShell>
  );
}
