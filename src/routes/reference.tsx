import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";
import { SITE_URL } from "@/lib/seo/site";
import {
  absUrl,
  articleLd,
  breadcrumbLd,
  SITE_NAME,
  OG_IMAGE,
} from "@/lib/seo/site";

// ── Route ─────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/reference")({
  head: () => {
    const path = "/reference";
    const title = `API Reference · ${SITE_NAME}`;
    const description =
      "Full reference for the OpenJev public API: POST /systemone, /batch, /validate, /calibration, GET /status, /health, /keys, and /usage — request and response schemas with examples.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "keywords", content: "openjev api, systemone api, typed decision api, openapi, api reference" },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: absUrl(path) },
        { property: "og:image", content: OG_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        {
          "script:ld+json": articleLd({
            headline: "OpenJev API Reference",
            description,
            path,
            dateModified: "2026-09-23",
            keywords: ["openjev api", "systemone", "typed decisions", "openapi 3.1"],
          }),
        },
        {
          "script:ld+json": breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Reference", path },
          ]),
        },
      ],
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: ReferencePage,
});

// ── Operation data ─────────────────────────────────────────────────────────
// A typed summary of each operation — derived from public/openapi.json.
// Serves as the page's rendering source without requiring a dynamic import.

interface Param {
  name: string;
  in: "query" | "path" | "header";
  type: string;
  required: boolean;
  description: string;
}

interface BodyField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface ResponseEntry {
  status: string;
  description: string;
  example?: string;
}

interface Operation {
  id: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  tag: string;
  summary: string;
  description: string;
  auth: boolean;
  params?: Param[];
  bodyFields?: BodyField[];
  requestExample?: string;
  responses: ResponseEntry[];
}

const OPERATIONS: readonly Operation[] = [
  // ── Decisions ────────────────────────────────────────────────────────────
  {
    id: "createSystemOne",
    method: "POST",
    path: "/api/v1/systemone",
    tag: "Decisions",
    summary: "Execute typed decisions",
    description:
      "Submit a shared state and one or more typed questions. Returns a calibrated typed answer per question — Choice (label + full distribution), Score (level + distribution), or Noul (calibrated P(yes)). All questions share one state read, so a 13-item checklist is one call with near-zero output tokens.",
    auth: true,
    bodyFields: [
      { name: "model", type: "string?", required: false, description: "Model id. Defaults to system-one." },
      { name: "state", type: "string | object | array", required: true, description: "Shared context read by every question in this request." },
      { name: "questions", type: "{ [key]: Question }", required: true, description: "Map of answer key → typed question (choice, score, or noul)." },
    ],
    requestExample: `{
  "state": { "ticket": "My card was charged twice last Friday." },
  "questions": {
    "category": {
      "type": "choice",
      "instructions": "Main request in \`ticket\`?",
      "criteria": {
        "refund": "Wants money returned.",
        "rebooking": "Wants a replacement flight.",
        "info": "Asking for information only."
      }
    },
    "severity": {
      "type": "score",
      "instructions": "Urgency of \`ticket\` (0 low, 5 critical)?",
      "criteria": [
        "Cosmetic", "Low", "Moderate",
        "High", "Critical", "Existential"
      ]
    },
    "is_angry": {
      "type": "noul",
      "instructions": "Does \`ticket\` express anger?"
    }
  }
}`,
    responses: [
      {
        status: "200",
        description: "Decision executed.",
        example: `{
  "model": "system-one",
  "answers": {
    "category": {
      "type": "choice",
      "choice": "refund",
      "probabilities": { "refund": 0.87, "rebooking": 0.09, "info": 0.04 },
      "confidence": 0.87
    },
    "severity": {
      "type": "score",
      "score": 3,
      "legend": { "3": "High" },
      "probabilities": { "0": 0.02, "1": 0.04, "2": 0.10, "3": 0.61, "4": 0.18, "5": 0.05 },
      "confidence": 0.61
    },
    "is_angry": { "type": "noul", "noul": 0.31 }
  },
  "usage": { "input_tokens": 74, "output_tokens": 0 },
  "latency_ms": 4.2
}`,
      },
      { status: "400", description: "Invalid request (missing fields, bad question shape, unknown model)." },
      { status: "402", description: "Allowance exceeded for this key." },
      { status: "429", description: "Rate limit or monthly quota exceeded." },
    ],
  },
  {
    id: "getSystemOneInfo",
    method: "GET",
    path: "/api/v1/systemone",
    tag: "Decisions",
    summary: "API info",
    description:
      "Returns the API name, available model ids, supported primitives, and the wire-compatibility string. No auth required.",
    auth: false,
    responses: [
      {
        status: "200",
        description: "API info.",
        example: `{
  "name": "openjev",
  "models": ["system-one", "jev-sharp", "jev-decisive",
             "laya-mlx", "laya-onnx", "openjev-grok"],
  "primitives": ["choice", "score", "noul"],
  "compatible": "OpenJev System One v1"
}`,
      },
    ],
  },
  {
    id: "batchSystemOne",
    method: "POST",
    path: "/api/v1/batch",
    tag: "Decisions",
    summary: "Batch decisions",
    description:
      "Execute multiple independent System One requests in a single HTTP call. Requests are evaluated in parallel; the response array preserves input order. Up to 100 requests per call.",
    auth: true,
    bodyFields: [
      { name: "requests", type: "SystemOneRequest[]", required: true, description: "Array of System One requests (1–100)." },
    ],
    requestExample: `{
  "requests": [
    {
      "state": "Great product, arrived quickly.",
      "questions": {
        "sentiment": {
          "type": "score",
          "instructions": "Sentiment (1 negative … 5 positive)?",
          "criteria": ["Very negative","Negative","Neutral","Positive","Very positive"]
        }
      }
    },
    {
      "state": "Order never arrived after three weeks.",
      "questions": {
        "sentiment": {
          "type": "score",
          "instructions": "Sentiment (1 negative … 5 positive)?",
          "criteria": ["Very negative","Negative","Neutral","Positive","Very positive"]
        }
      }
    }
  ]
}`,
    responses: [
      {
        status: "200",
        description: "All decisions resolved.",
        example: `{
  "results": [
    { "model": "system-one", "answers": { "sentiment": { "type": "score", "score": 4, "confidence": 0.81 } }, "latency_ms": 3.1 },
    { "model": "system-one", "answers": { "sentiment": { "type": "score", "score": 0, "confidence": 0.77 } }, "latency_ms": 2.9 }
  ]
}`,
      },
    ],
  },
  {
    id: "validateRequest",
    method: "POST",
    path: "/api/v1/validate",
    tag: "Decisions",
    summary: "Validate a request payload",
    description:
      "Dry-run validation for a System One payload. Returns errors without executing any decision — useful for catching malformed questions before sending to production.",
    auth: true,
    bodyFields: [
      { name: "state", type: "string | object | array", required: true, description: "Shared context (validated only, not evaluated)." },
      { name: "questions", type: "{ [key]: Question }", required: true, description: "Questions to validate." },
    ],
    responses: [
      {
        status: "200",
        description: "Validation result.",
        example: `{ "valid": true, "errors": [] }`,
      },
    ],
  },
  {
    id: "runCalibration",
    method: "POST",
    path: "/api/v1/calibration",
    tag: "Decisions",
    summary: "Calibration metrics",
    description:
      "Evaluate calibration quality (ECE, Brier score, accuracy) over a labelled example set. Measures how well confidence scores track observed accuracy on your data, so you can pick operating thresholds with confidence.",
    auth: true,
    bodyFields: [
      { name: "model", type: "string?", required: false, description: "Model to evaluate. Defaults to system-one." },
      { name: "examples", type: "{ request, gold }[]", required: true, description: "Labelled examples: each with a System One request and expected answers." },
    ],
    responses: [
      {
        status: "200",
        description: "Calibration metrics.",
        example: `{
  "model": "system-one",
  "n": 500,
  "accuracy": 0.891,
  "ece": 0.043,
  "brier": 0.118
}`,
      },
    ],
  },
  // ── Status ───────────────────────────────────────────────────────────────
  {
    id: "getStatus",
    method: "GET",
    path: "/api/v1/status",
    tag: "Status",
    summary: "Backend health",
    description:
      "Returns health for every backend on this deployment — local (always available), native sidecar, neural (Laya MLX/ONNX), any-LLM, and OpenJev cloud. Each model card includes an available flag and, when unavailable, a reason and install hint. Not cached.",
    auth: false,
    responses: [
      {
        status: "200",
        description: "Backend status.",
        example: `{
  "object": "backend_status",
  "local": { "available": true },
  "native": { "available": false, "url": "http://localhost:8765" },
  "laya":   { "available": false, "backend": "onnx", "url": "http://localhost:8766" },
  "llm":    { "available": false },
  "cloud":  { "available": false },
  "models": [
    { "id": "system-one", "backend": "local", "available": true },
    { "id": "laya-onnx",  "backend": "laya",  "available": false,
      "reason": "laya_sidecar_unreachable",
      "install": "Start the neural sidecar (Laya) — see SELF-HOSTING.md." }
  ]
}`,
      },
    ],
  },
  {
    id: "getHealth",
    method: "GET",
    path: "/api/v1/",
    tag: "Status",
    summary: "Liveness / API info",
    description:
      "Lightweight liveness probe. Returns API name, version, wire-compatibility info, active engine info, and the endpoint list.",
    auth: false,
    responses: [
      {
        status: "200",
        description: "API is live.",
        example: `{
  "name": "openjev",
  "version": "0.2",
  "compatible": "http://localhost:3000/api/v1/systemone",
  "engine": { "backend": "typescript-fallback" }
}`,
      },
    ],
  },
  // ── Keys ─────────────────────────────────────────────────────────────────
  {
    id: "listKeys",
    method: "GET",
    path: "/api/v1/keys",
    tag: "Keys",
    summary: "List API keys",
    description:
      "Returns all API keys for the authenticated account. Full key values are never returned; only the prefix and metadata.",
    auth: true,
    responses: [
      {
        status: "200",
        description: "Keys returned.",
        example: `{
  "keys": [
    {
      "id": "key_01hx",
      "name": "Production",
      "prefix": "ots_live_",
      "created_at": "2026-09-01T00:00:00Z",
      "last_used_at": "2026-09-23T08:12:00Z"
    }
  ]
}`,
      },
    ],
  },
  {
    id: "createKey",
    method: "POST",
    path: "/api/v1/keys",
    tag: "Keys",
    summary: "Create API key",
    description:
      "Creates a new API key. The full key value (ots_live_…) is returned exactly once — store it securely. It cannot be retrieved again.",
    auth: true,
    bodyFields: [
      { name: "name", type: "string", required: true, description: "Human-readable label for this key." },
    ],
    requestExample: `{ "name": "Production" }`,
    responses: [
      {
        status: "200",
        description: "Key created.",
        example: `{
  "id": "key_01hx",
  "name": "Production",
  "key": "ots_live_xxxxxxxxxxxxxxxxxxxx",
  "created_at": "2026-09-23T09:00:00Z"
}`,
      },
    ],
  },
  // ── Usage ─────────────────────────────────────────────────────────────────
  {
    id: "getUsage",
    method: "GET",
    path: "/api/v1/usage",
    tag: "Usage",
    summary: "Usage statistics",
    description:
      "Returns token and call counts for the authenticated key, broken down by model and period.",
    auth: true,
    params: [
      { name: "period", in: "query", type: "day | week | month", required: false, description: "Aggregation period. Defaults to month." },
    ],
    responses: [
      {
        status: "200",
        description: "Usage data.",
        example: `{
  "period": "month",
  "total_calls": 14820,
  "total_input_tokens": 1092400,
  "total_output_tokens": 420,
  "by_model": [
    { "model": "system-one", "calls": 14100, "input_tokens": 1039800 },
    { "model": "openjev-grok", "calls": 720, "input_tokens": 52600 }
  ]
}`,
      },
    ],
  },
];

const TAGS = ["Decisions", "Status", "Keys", "Usage"] as const;

// ── Components ────────────────────────────────────────────────────────────

const METHOD_TEXT: Record<string, string> = {
  GET: "text-ok",
  POST: "text-fg",
  PUT: "text-muted",
  DELETE: "text-destructive",
  PATCH: "text-muted",
};

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-sm bg-raised px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]",
        METHOD_TEXT[method] ?? "text-muted",
      )}
    >
      {method}
    </span>
  );
}

function CodeBlock({ code, lang = "json" }: { code: string; lang?: string }) {
  return (
    <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          {lang}
        </p>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
        {code}
      </pre>
    </div>
  );
}

function OperationCard({ op }: { op: Operation }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md bg-surface shadow-[var(--shadow-border)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-5 py-4 text-left"
      >
        <MethodBadge method={op.method} />
        <div className="min-w-0 flex-1">
          <code className="font-mono text-sm text-fg">{op.path}</code>
          <p className="mt-0.5 text-sm text-muted">{op.summary}</p>
        </div>
        <span className="mt-1 shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
          {open ? "close" : "expand"}
        </span>
      </button>

      {open ? (
        <div className="space-y-6 border-t border-border px-5 pb-6 pt-5">
          <p className="text-sm leading-relaxed text-muted">{op.description}</p>

          {/* Auth ─────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Auth
            </span>
            <span
              className={cn(
                "font-mono text-xs",
                op.auth ? "text-muted" : "text-ok",
              )}
            >
              {op.auth ? "Bearer token required" : "No auth required"}
            </span>
          </div>

          {/* Params ──────────────────────────────────────────────── */}
          {op.params && op.params.length > 0 ? (
            <section className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Query parameters
              </p>
              <div className="overflow-x-auto rounded-md bg-inset">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Required</th>
                      <th className="px-3 py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted">
                    {op.params.map((p) => (
                      <tr key={p.name} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-fg">{p.name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{p.type}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {p.required ? "yes" : "no"}
                        </td>
                        <td className="px-3 py-2 text-xs leading-relaxed">{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Request body fields ──────────────────────────────────── */}
          {op.bodyFields && op.bodyFields.length > 0 ? (
            <section className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Request body fields
              </p>
              <div className="overflow-x-auto rounded-md bg-inset">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                    <tr>
                      <th className="px-3 py-2">Field</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Required</th>
                      <th className="px-3 py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted">
                    {op.bodyFields.map((f) => (
                      <tr key={f.name} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-fg">{f.name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{f.type}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {f.required ? "yes" : "no"}
                        </td>
                        <td className="px-3 py-2 text-xs leading-relaxed">{f.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Request example ──────────────────────────────────────── */}
          {op.requestExample ? (
            <section className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Request example
              </p>
              <CodeBlock code={op.requestExample} />
            </section>
          ) : null}

          {/* Responses ────────────────────────────────────────────── */}
          <section className="space-y-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Responses
            </p>
            {op.responses.map((r) => (
              <div key={r.status} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold",
                      r.status.startsWith("2")
                        ? "bg-ok/10 text-ok"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {r.status}
                  </span>
                  <span className="text-sm text-muted">{r.description}</span>
                </div>
                {r.example ? <CodeBlock code={r.example} /> : null}
              </div>
            ))}
          </section>
        </div>
      ) : null}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

function ReferencePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-14">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Developer
          </p>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            API Reference
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted">
            One endpoint for typed decisions. Submit a state and typed questions;
            get back Choice labels, Score levels, and Noul probabilities — all
            calibrated, with no generated text.
          </p>
        </header>

        {/* Auth ──────────────────────────────────────────────────────── */}
        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
            Authentication
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            Pass your API key as a Bearer token.{" "}
            <span className="font-mono text-fg">
              Authorization: Bearer ots_live_…
            </span>{" "}
            Keys are created and managed under{" "}
            <a
              href="/keys"
              className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
            >
              /keys
            </a>
            . On self-hosted instances without auth, omit the header or pass{" "}
            <span className="font-mono text-fg">anon</span>.
          </p>
          <div className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] text-fg">
            curl -X POST {SITE_URL}/api/v1/systemone \<br />
            {"  "}-H "Authorization: Bearer ots_live_…" \<br />
            {"  "}-H "Content-Type: application/json" \<br />
            {"  "}-d '{"{"}"state":"…","questions":{"{"}"q":{"{"}"type":"noul","instructions":"…"{"}"}{"}"}{"}"}{"}"}'
          </div>
        </section>

        {/* Base URLs ─────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">Base URLs</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Hosted</p>
              <code className="mt-1 block text-sm text-fg">{SITE_URL}</code>
              <p className="mt-1 text-xs text-muted">Wire-compatible with System One v1. Requires an API key.</p>
            </div>
            <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Self-hosted</p>
              <code className="mt-1 block text-sm text-fg">http://localhost:3000</code>
              <p className="mt-1 text-xs text-muted">Docker image. Anonymous use, no token bill.</p>
            </div>
          </div>
          <p className="text-sm text-muted">
            The machine-readable OpenAPI 3.1 spec is available at{" "}
            <a
              href="/openapi.json"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
            >
              /openapi.json
            </a>
            .
          </p>
        </section>

        {/* Operations by tag ─────────────────────────────────────────── */}
        {TAGS.map((tag) => {
          const ops = OPERATIONS.filter((o) => o.tag === tag);
          return (
            <section key={tag} className="space-y-4">
              <h2 className="text-lg font-medium tracking-tight">{tag}</h2>
              <div className="space-y-2">
                {ops.map((op) => (
                  <OperationCard key={op.id} op={op} />
                ))}
              </div>
            </section>
          );
        })}

        {/* Primitives quick-ref ──────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Question primitives
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                {
                  type: "choice",
                  heading: "Choice",
                  blurb:
                    "Classify into one of 2–255 labelled options. Returns the winning label, full distribution, and calibrated confidence.",
                  fields: "type, instructions, criteria (object)",
                },
                {
                  type: "score",
                  heading: "Score",
                  blurb:
                    "Rate on an ordered rubric of 2–10 levels. Returns the winning level index, distribution, and confidence.",
                  fields: "type, instructions, criteria (array)",
                },
                {
                  type: "noul",
                  heading: "Noul",
                  blurb:
                    "Calibrated P(yes) for a single yes/no proposition. Returns a float in [0,1] — threshold to gate.",
                  fields: "type, instructions, criteria? ({true,false})",
                },
              ] as const
            ).map((p) => (
              <div
                key={p.type}
                className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  {p.type}
                </p>
                <p className="font-medium tracking-tight text-fg">{p.heading}</p>
                <p className="text-sm leading-relaxed text-muted">{p.blurb}</p>
                <p className="font-mono text-[11px] text-subtle">{p.fields}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
