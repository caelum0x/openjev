import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/self-hosting")({
  head: () =>
    pageHead("Self-hosting", "Run OpenJev on your own infrastructure with Docker Compose."),
  component: SelfHostingPage,
});

const QUICKSTART = `cp .env.example .env          # optional — nothing is required to boot
docker compose up --build`;

const COMPOSE = `services:
  openjev:
    build: { context: ., dockerfile: Dockerfile }
    ports: ["\${PORT:-3000}:3000"]
    environment:
      PORT: "3000"
      HOST: "0.0.0.0"
      # Reach the neural sidecar over the compose network.
      LAYA_ENGINE_URL: "http://laya-onnx:8092"
      LAYA_BACKEND: "onnx"
      DATABASE_URL: "\${DATABASE_URL:-}"       # unset = in-memory PGLite
      LLM_PROVIDER: "\${LLM_PROVIDER:-}"       # unset = local engine only
    depends_on: [laya-onnx]

  laya-onnx:
    build: { context: ., dockerfile: Dockerfile.laya }
    environment:
      LAYA_BACKEND: "onnx"
      LAYA_HOST: "0.0.0.0"
      LAYA_PORT: "8092"
      LAYA_MODEL: "\${LAYA_MODEL:-base}"
    volumes:
      - laya-models:/models   # persist downloaded weights
    expose: ["8092"]

volumes:
  laya-models:`;

const DB = `DATABASE_URL=postgresql://openjev:openjev@db:5432/openjev`;

const LLM = `LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...`;

const NODE = `# 1. Install deps and build the standalone Node server
npm ci
NITRO_PRESET=node-server npm run build     # or: npm run build:node

# 2. (optional) Download Laya weights and start the sidecar
npm run laya-download                       # = openjev laya-download
LAYA_BACKEND=onnx python3 scripts/laya_sidecar.py

# 3. Serve the Node service (honors PORT, default 3000)
npm run serve                               # = openjev serve`;

const CLI = `openjev laya-download
openjev serve`;

type EnvVar = {
  name: string;
  purpose: string;
  fallback: string;
};

const ENV_VARS: ReadonlyArray<EnvVar> = [
  { name: "PORT / HOST", purpose: "Node server bind", fallback: "3000 / 0.0.0.0" },
  {
    name: "LAYA_BACKEND",
    purpose: "mlx (Apple Silicon) or onnx (Linux/CPU)",
    fallback: "auto",
  },
  {
    name: "LAYA_ENGINE_URL",
    purpose: "Neural sidecar (Laya) URL",
    fallback: "http://127.0.0.1:8092",
  },
  {
    name: "OPENJEV_ENGINE_URL",
    purpose: "Native C++/Rust engine URL",
    fallback: "http://127.0.0.1:8091",
  },
  {
    name: "DATABASE_URL",
    purpose: "Postgres; in-memory PGLite fallback if unset",
    fallback: "unset",
  },
  {
    name: "LLM_PROVIDER + *_API_KEY",
    purpose: "Optional hosted LLM escalation",
    fallback: "off",
  },
  {
    name: "VITE_AUTH_ENABLED / BETTER_AUTH_SECRET",
    purpose: "Self-host sign-in + signing secret",
    fallback: "false",
  },
];

type Backend = { name: string; detail: string };

const BACKENDS: ReadonlyArray<Backend> = [
  {
    name: "pure-TS engine",
    detail: "Always on; zero native deps; runs anywhere Node runs.",
  },
  { name: "laya-onnx sidecar", detail: "CPU neural backend — this Compose setup." },
  {
    name: "laya-mlx",
    detail: "Apple Silicon native; run LAYA_BACKEND=mlx on macOS instead of the sidecar.",
  },
  {
    name: "native C++/Rust kernel",
    detail: "In engine/; point OPENJEV_ENGINE_URL at it if built.",
  },
  {
    name: "any-LLM escalation",
    detail: "Optional hosted provider (openai / xai / anthropic) for low-confidence decisions.",
  },
];

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
          {label}
        </p>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
        {code}
      </pre>
    </div>
  );
}

function SelfHostingPage() {
  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Self-hosting
          </p>
          <h1 className="text-3xl font-medium tracking-tight">
            Run OpenJev yourself
          </h1>
          <p className="text-sm leading-relaxed text-muted">
            OpenJev self-hosts as two containers: the{" "}
            <span className="font-mono text-fg">Node service</span> (the
            typed-decision API plus this console) and a{" "}
            <span className="font-mono text-fg">laya-onnx</span> sidecar (the CPU
            neural backend). The Node service runs the pure-TS decision engine out
            of the box, so it works before any model weights or provider keys are
            configured. Apache-2.0.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to="/reference" className={cn(buttonVariants({ variant: "secondary" }))}>
              API reference →
            </Link>
            <Link
              to="/changelog"
              className={cn(buttonVariants({ variant: "ghost" }))}
            >
              Changelog
            </Link>
          </div>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Quickstart (Docker Compose)
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            Two commands. Compose builds both images, starts the laya-onnx sidecar
            (which downloads its weights on first boot into a persistent{" "}
            <span className="font-mono text-fg">laya-models</span> volume), and
            wires the Node service to it via{" "}
            <span className="font-mono text-fg">LAYA_ENGINE_URL</span>.
          </p>
          <CodeBlock code={QUICKSTART} label="shell" />
          <p className="text-sm leading-relaxed text-muted">
            Then open{" "}
            <span className="font-mono text-fg">http://localhost:3000</span>. The
            API is at{" "}
            <span className="font-mono text-fg">
              POST http://localhost:3000/v1/systemone
            </span>{" "}
            and the playground / docs / keys / usage UI is at the same origin. Stop
            with <span className="font-mono text-fg">Ctrl-C</span>; tear down with{" "}
            <span className="font-mono text-fg">docker compose down</span> (add{" "}
            <span className="font-mono text-fg">-v</span> to also drop the
            downloaded weights).
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Compose with the laya-onnx sidecar
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            The Node service auto-detects the sidecar over the compose network. The
            durable weights volume means restarts do not re-fetch the model.
          </p>
          <CodeBlock code={COMPOSE} label="docker-compose.yml" />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Durable database (optional)
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            By default the Node service uses an in-memory PGLite database — data
            resets on restart. For persistence, uncomment the{" "}
            <span className="font-mono text-fg">db</span> (Postgres) service and the{" "}
            <span className="font-mono text-fg">pgdata</span> volume in{" "}
            <span className="font-mono text-fg">docker-compose.yml</span>, then set
            this in <span className="font-mono text-fg">.env</span>. Migrations run
            automatically at container start.
          </p>
          <CodeBlock code={DB} label=".env" />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            LLM escalation (optional)
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            To let hard decisions escalate to a hosted model, set a provider key in{" "}
            <span className="font-mono text-fg">.env</span>. Supported providers:{" "}
            <span className="font-mono text-fg">openai</span>,{" "}
            <span className="font-mono text-fg">xai</span> (Grok),{" "}
            <span className="font-mono text-fg">anthropic</span> (Claude). With no
            key set, the service always answers from the local engine.
          </p>
          <CodeBlock code={LLM} label=".env" />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Running without Docker (Node + CLI)
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            The package ships an{" "}
            <span className="font-mono text-fg">OpenJev</span> CLI with two
            subcommands.{" "}
            <span className="font-mono text-fg">openjev serve</span> starts the
            built Node server on{" "}
            <span className="font-mono text-fg">PORT</span> (default 3000) and{" "}
            <span className="font-mono text-fg">HOST</span> (default 0.0.0.0);{" "}
            <span className="font-mono text-fg">openjev laya-download</span>{" "}
            fetches neural model (Laya) weights from Hugging Face, honoring{" "}
            <span className="font-mono text-fg">LAYA_BACKEND</span> /{" "}
            <span className="font-mono text-fg">LAYA_MODEL</span> /{" "}
            <span className="font-mono text-fg">LAYA_DEST</span>.
          </p>
          <CodeBlock code={NODE} label="shell" />
          <p className="text-sm leading-relaxed text-muted">
            Once installed globally (
            <span className="font-mono text-fg">npm link</span> or{" "}
            <span className="font-mono text-fg">npm i -g</span>), the same commands
            are:
          </p>
          <CodeBlock code={CLI} label="shell" />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">Configuration</h2>
          <p className="text-sm leading-relaxed text-muted">
            Every environment variable is documented in{" "}
            <span className="font-mono text-fg">.env.example</span>. Nothing is
            required to boot. The most relevant knobs:
          </p>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2">Variable</th>
                  <th className="px-3 py-2">Purpose</th>
                  <th className="px-3 py-2">Default</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                {ENV_VARS.map((v) => (
                  <tr key={v.name} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-fg">{v.name}</td>
                    <td className="px-3 py-2">{v.purpose}</td>
                    <td className="px-3 py-2 font-mono text-xs">{v.fallback}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Backends at a glance
          </h2>
          <ul className="space-y-2">
            {BACKENDS.map((b) => (
              <li
                key={b.name}
                className="flex flex-col gap-0.5 rounded-md bg-surface p-4 shadow-[var(--shadow-border)] sm:flex-row sm:items-baseline sm:gap-3"
              >
                <span className="shrink-0 font-mono text-xs text-fg sm:w-44">
                  {b.name}
                </span>
                <span className="text-sm leading-relaxed text-muted">
                  {b.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <Link to="/docs" className="hover:text-fg">
            Documentation
          </Link>
          <Link to="/changelog" className="hover:text-fg">
            Changelog
          </Link>
          <Link to="/keys" className="hover:text-fg">
            API key
          </Link>
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            OpenJev · Apache-2.0
          </span>
        </footer>
      </article>
    </AppShell>
  );
}
