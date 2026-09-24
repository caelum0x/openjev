import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/about")({
  head: () =>
    pageHead("About", "Who builds OpenJev, why typed decisions, and how the project is licensed."),
  component: AboutPage,
});

const PRIMITIVES: ReadonlyArray<{
  name: string;
  color: string;
  returns: string;
  use: string;
}> = [
  {
    name: "Choice",
    color: "bg-choice",
    returns: "one option + full probability distribution + confidence",
    use: "Pick exactly one of up to ~255 named options — route, classify, label.",
  },
  {
    name: "Score",
    color: "bg-score",
    returns: "a rubric level + legend + distribution + confidence",
    use: "Grade against a 2–10 level ordered rubric — rank, rate, triage severity.",
  },
  {
    name: "Noul",
    color: "bg-noul",
    returns: "a calibrated probability in [0,1] — P(yes)",
    use: "A soft yes/no you threshold in code — gate, detect, verify.",
  },
];

const BACKENDS: ReadonlyArray<{ id: string; note: string }> = [
  { id: "laya-mlx", note: "Apple-silicon inference via MLX — fast local judgments on a Mac." },
  { id: "laya-onnx", note: "Portable ONNX runtime for Linux / CPU — the default in production." },
  { id: "native", note: "Built-in lexical, contrastive scorer — zero external model, deterministic." },
  { id: "local", note: "Point at a local model server you already run." },
  { id: "any-LLM", note: "Wrap any chat LLM as a System One backend when you want a hosted brain." },
];

const FREETEXT = `// The old way: prompt an LLM, hope the JSON parses.
const res = await llm.chat("Is this a refund request? Reply JSON: {yes: bool}");
const parsed = JSON.parse(res); // may throw, may hallucinate a field
if (parsed.yes) { /* and how sure was it? unknown */ }`;

const TYPED = `// The typed way: ask for a Noul, get a calibrated number back.
const out = await client.systemOne({
  model: "system-one",
  state: { ticket: "My flight was cancelled. Can I get a refund?" },
  questions: { refund: noul("Does \`ticket\` request a refund?") },
});
if (out.answers.refund.noul >= 0.7) { /* threshold you own, in code */ }`;

function AboutPage() {
  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-14">
        <header className="space-y-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            About
          </p>
          <h1 className="max-w-2xl text-3xl font-medium tracking-tight md:text-4xl">
            What a typed decision is, and why it beats free-text JSON.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            OpenJev is an open-source, self-hostable decision engine. It
            exposes a single idea: small units of AI judgment you use like
            programming primitives. Send a state and typed questions to{" "}
            <span className="font-mono text-fg">POST /api/v1/systemone</span>; get
            back a Choice, a Score, or a Noul — with the probability distribution
            behind it — that your code combines deterministically.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            A typed decision, defined
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            A typed decision is a question whose answer space you define in
            advance, evaluated by a model that understands natural language but
            only ever returns a value in that space. It never writes prose, never
            calls a tool, never explains itself. Because the shape is fixed, the
            result is something code can branch on directly — no parsing, no
            retries, no schema drift.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {PRIMITIVES.map((p) => (
              <div
                key={p.name}
                className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden className={cn("size-2.5 rounded-full", p.color)} />
                  <h3 className="font-medium tracking-tight text-fg">{p.name}</h3>
                </div>
                <p className="font-mono text-[11px] leading-relaxed text-subtle">
                  {p.returns}
                </p>
                <p className="text-sm leading-relaxed text-muted">{p.use}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Why Choice / Score / Noul beat free-text JSON
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Prompt-and-parse
              </p>
              <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
                {FREETEXT}
              </pre>
            </div>
            <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Typed decision
              </p>
              <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
                {TYPED}
              </pre>
            </div>
          </div>
          <ul className="max-w-2xl space-y-2 text-sm leading-relaxed text-muted">
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
              <span>
                <span className="text-fg">No parsing, no throwing.</span> The
                answer arrives in a known shape — there is no{" "}
                <span className="font-mono">JSON.parse</span> that can fail on a
                stray token.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
              <span>
                <span className="text-fg">Calibrated probabilities.</span> You get
                a distribution and a confidence scalar, not a lone guess dressed
                up as certainty.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
              <span>
                <span className="text-fg">A closed answer space.</span> A Choice
                can only be one of your options; a model can&apos;t invent a
                twelfth category or rename a field.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
              <span>
                <span className="text-fg">Composable in code.</span> Ask up to 64
                independent questions in one call and combine them with ordinary
                deterministic logic — the judgment stays in the model, the control
                flow stays in your code.
              </span>
            </li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Wire-compatible with the upstream System One v1 API
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            The name is Kahneman&apos;s. System 1 is fast and intuitive; System 2
            is slow and deliberate. OpenJev makes the fast, focused
            judgments — the kind you&apos;d want a sharp colleague to answer in a
            second, not write an essay about. It is wire-compatible with the
            upstream System One v1 API, so a payload written against OpenJev
            runs unchanged on any compatible endpoint and back again. Same
            primitives, same field names, same semantics — open source and under
            your control.
          </p>
          <div className="space-y-2 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Five interchangeable backends
            </p>
            <ul className="divide-y divide-border/60">
              {BACKENDS.map((b) => (
                <li key={b.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:gap-4">
                  <span className="w-28 shrink-0 font-mono text-sm text-fg">{b.id}</span>
                  <span className="text-sm leading-relaxed text-muted">{b.note}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Pick a backend per deployment; the API surface never changes. Talk to
            it directly over HTTP, or through the{" "}
            <span className="font-mono text-fg">@caelum/typesafe</span> client SDK.
            Agents can install the bundled SKILL.md and call the same endpoint.
          </p>
        </section>

        <section className="space-y-3 rounded-md bg-inset p-6">
          <h2 className="text-base font-medium tracking-tight">
            Try it, then run it yourself
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            The playground calls a live <span className="font-mono text-fg">system-one</span>{" "}
            model with no key on the same origin. When you&apos;re ready, self-host
            the whole thing under Apache-2.0.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to="/playground" className={cn(buttonVariants({ variant: "primary" }))}>
              Open the playground →
            </Link>
            <Link to="/system-one" className={cn(buttonVariants({ variant: "secondary" }))}>
              The model
            </Link>
            <Link to="/pricing" className={cn(buttonVariants({ variant: "secondary" }))}>
              Pricing
            </Link>
          </div>
        </section>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <Link to="/pricing" className="hover:text-fg">Pricing</Link>
          <Link to="/security" className="hover:text-fg">Trust Center</Link>
          <Link to="/privacy" className="hover:text-fg">Data Policy</Link>
          <Link to="/docs" className="hover:text-fg">Documentation</Link>
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            OpenJev · Apache-2.0
          </span>
        </footer>
      </article>
    </AppShell>
  );
}
