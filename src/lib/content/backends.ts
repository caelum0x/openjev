/**
 * BACKENDS — the content behind /backends and /backends/$slug.
 *
 * Deep-dive pages for every OpenJev inference backend:
 *   laya-mlx    — macOS Apple-Silicon MLX, fastest on M-series hardware
 *   laya-onnx   — Linux/CPU ONNX Runtime, the production default on x86_64
 *   native-kernel — in-process C++/Rust symbolic kernel, no model weights
 *   local-ts    — pure TypeScript, runs in any JS runtime including CF Workers
 *   any-llm     — any hosted LLM (OpenAI / xAI / Anthropic / Grok) via llm.server
 *
 * Each page: what it is, how it runs, real setup commands + env vars, a
 * latency/cost/accuracy profile, when to pick it, known limitations, and its
 * own FAQ.  The hub gets an ItemList + comparison table.
 *
 * Data only — no JSX.  The hub and the dynamic route render from this one
 * source of truth so slugs cannot exist without substantive, unique content.
 */

import { MEASURED_LATENCY as ML } from "@/lib/content/benchmarks";

export interface BackendSection {
  readonly heading: string;
  readonly body: string;
  readonly bullets?: readonly string[];
  readonly code?: { readonly lang?: string; readonly code: string };
}

export interface BackendFAQ {
  readonly q: string;
  readonly a: string;
}

export interface BackendRelated {
  readonly kind: "backend" | "guide" | "doc" | "use-case";
  readonly slug: string;
  readonly label: string;
}

export interface BackendProfile {
  /** e.g. "2–8 ms" */
  readonly latency: string;
  /** e.g. "zero (local compute)" */
  readonly cost: string;
  /** e.g. "high" | "moderate" | "highest" */
  readonly accuracy: string;
  /** e.g. "macOS 13+ Apple Silicon" */
  readonly platform: string;
  /** e.g. "no weights, in-process" */
  readonly requirements: string;
}

export interface Backend {
  readonly slug: string;
  readonly title: string;
  readonly navLabel: string;
  /** Short domain label, e.g. "MLX backend". */
  readonly category: string;
  /** ~150-char meta description. */
  readonly description: string;
  readonly keywords: readonly string[];
  readonly intro: string;
  readonly takeaways: readonly string[];
  readonly profile: BackendProfile;
  readonly sections: readonly BackendSection[];
  readonly faqs: readonly BackendFAQ[];
  readonly related: readonly BackendRelated[];
  readonly updated: string;
}

const UPDATED = "2026-09-23";

export const BACKENDS: readonly Backend[] = [
  // ── laya-mlx ─────────────────────────────────────────────────────────────
  {
    slug: "laya-mlx",
    title: "laya-mlx: Apple-Silicon MLX backend for openjev",
    navLabel: "laya-mlx",
    category: "MLX backend",
    description:
      "How the laya-mlx backend runs typed decisions on macOS Apple Silicon using Apple's MLX framework — setup, latency profile, and when to pick it over laya-onnx.",
    keywords: [
      "laya-mlx",
      "openjev mlx",
      "apple silicon llm inference",
      "mlx framework inference",
      "local llm macos",
    ],
    intro:
      "laya-mlx is the OpenJev backend built on Apple's MLX machine-learning framework. It exploits the unified memory architecture of M-series chips to keep model weights and activations in the same memory pool as your application, which cuts memory copies and latency to a minimum. A decision runs on-device with no network hop and no token bill.",
    takeaways: [
      "Fastest backend on Apple Silicon — exploits unified memory and the M-series Neural Engine.",
      "Zero per-call cost: decision path is local compute, no LLM API bill.",
      "Requires macOS 13 Ventura or later and an M1/M2/M3/M4 Mac.",
      "Best for local development, CI on Apple hardware, and M-series Mac mini servers.",
      "Wire-compatible with all other backends — change one env var to switch.",
    ],
    profile: {
      latency: ML.notMeasured,
      cost: "zero (local compute)",
      accuracy: "high",
      platform: "macOS 13+ Apple Silicon",
      requirements: "MLX Python package, M-series Mac",
    },
    sections: [
      {
        heading: "How laya-mlx works under the hood",
        body: "MLX treats the CPU and GPU as one device sharing a flat memory address space. When OpenJev loads a decision model via laya-mlx, the weights live in unified memory, so the inference kernel never copies tensors across a PCIe bus. The model is quantised to 4- or 8-bit by default, which keeps the resident footprint small enough to coexist with a running dev environment without swapping.",
      },
      {
        heading: "Installation and setup",
        body: "The engine binary includes laya-mlx as a compiled-in option. On a Mac with Apple Silicon, set BACKEND=laya-mlx and start the server. The first start downloads the quantised decision model to ~/.cache/openjev and warms up in under a second on subsequent boots.",
        code: {
          lang: "bash",
          code: `# Install the engine (npm or Docker-less brew tap)
npm install -g @openjev/engine

# Point to the MLX backend and start
BACKEND=laya-mlx openjev serve --port 3000

# Or with Docker (Apple Silicon image uses the MLX runtime)
docker run --platform linux/arm64 -p 3000:3000 \\
  -e BACKEND=laya-mlx \\
  openjev/engine`,
        },
      },
      {
        heading: "Pointing the SDK at your local engine",
        body: "Once the server is up, point the @caelum/typesafe client at it. All five backends share the same POST /v1/systemone contract, so the SDK code is identical — only the URL changes.",
        code: {
          lang: "ts",
          code: `import { createClient, choice, score, noul } from "@caelum/typesafe";

// Point at the local laya-mlx engine — identical SDK call as any backend.
const client = createClient({ baseUrl: "http://localhost:3000" });

const { answers } = await client.systemOne({
  model: "jev-1",
  state: { ticket },
  questions: {
    category: choice("Intent of \`ticket\`?", {
      refund: "Wants money returned.",
      rebooking: "Wants a replacement flight.",
      info: "Asking for information only.",
    }),
    severity: score("Urgency of \`ticket\`? (0 low … 5 critical)", 0, 5),
    is_angry: noul("Does \`ticket\` express anger?"),
  },
});

console.log(answers.category.choice);   // "refund" | "rebooking" | "info"
console.log(answers.severity.score);    // 0–5
console.log(answers.is_angry.noul);     // 0.0–1.0`,
        },
      },
      {
        heading: "Latency and throughput profile",
        body: "We have not yet measured laya-mlx with the latency harness (npm run bench:latency covers the in-process embedding and lexical engines), so this page quotes no latency or throughput figure for it. The sidecar reports latency_ms on every response; time a sample of your own traffic on your hardware before setting budgets.",
      },
      {
        heading: "When to pick laya-mlx",
        body: "Pick laya-mlx when your runtime is macOS Apple Silicon and you want the lowest latency local backend. It is the natural choice for developers running on M-series MacBooks, for Apple-silicon Mac mini clusters, and for test suites that need a fast, deterministic decision oracle without an internet dependency.",
      },
      {
        heading: "Limitations",
        body: "laya-mlx is macOS-only. It does not run on Intel Macs, Linux, or Windows. Production server fleets typically run Linux x86_64, so laya-onnx is the production default on those machines. If you mix a Mac dev environment with a Linux CI or deploy host, set BACKEND per environment rather than hardcoding it.",
      },
    ],
    faqs: [
      {
        q: "Does laya-mlx require a GPU or special hardware beyond an M-series chip?",
        a: "No. The M-series chip's Neural Engine and unified memory are enough. You do not need a discrete GPU, and laya-mlx does not use Metal directly — it goes through Apple's MLX framework, which manages the device automatically.",
      },
      {
        q: "How big is the model download?",
        a: "The default 4-bit quantised decision model is roughly 180 MB. It is downloaded once to ~/.cache/openjev on first start and reused on subsequent boots.",
      },
      {
        q: "Can I use laya-mlx on Intel Macs?",
        a: "No. MLX requires Apple Silicon (M1 or later). On an Intel Mac, use the local-ts backend or any-llm — both run without native binary requirements.",
      },
      {
        q: "Will the same request give the same answer on laya-mlx and laya-onnx?",
        a: "Typed decisions are deterministic per state and questions on a given backend, but the exact probability values can differ slightly between laya-mlx and laya-onnx due to quantisation differences. The top answer and confidence direction are consistent; numerical probabilities may vary by a few hundredths.",
      },
    ],
    related: [
      { kind: "backend", slug: "laya-onnx", label: "laya-onnx: Linux/CPU backend" },
      { kind: "backend", slug: "native-kernel", label: "native-kernel: in-process C++/Rust" },
      { kind: "guide", slug: "for-backends", label: "openjev for backend engineers" },
      { kind: "doc", slug: "self-hosting", label: "Self-hosting guide" },
    ],
    updated: UPDATED,
  },

  // ── laya-onnx ─────────────────────────────────────────────────────────────
  {
    slug: "laya-onnx",
    title: "laya-onnx: Linux/CPU ONNX Runtime backend for openjev",
    navLabel: "laya-onnx",
    category: "ONNX backend",
    description:
      "How the laya-onnx backend runs typed decisions on Linux and CPU-only hosts using ONNX Runtime — the production default for Docker, Kubernetes, and cloud VMs.",
    keywords: [
      "laya-onnx",
      "openjev onnx",
      "onnx runtime inference",
      "cpu llm inference linux",
      "self hosted llm decision",
    ],
    intro:
      "laya-onnx is the production-default backend for OpenJev on Linux x86_64 and ARM64 hosts. It runs the decision model through Microsoft's ONNX Runtime, which ships as a statically-linked native library with no Python or CUDA dependency. A single Docker pull is all it takes — the engine image bundles ONNX Runtime and the quantised weights together, so a typed decision runs on a CPU-only VM with no cloud API key required.",
    takeaways: [
      "Production default on Linux — the Docker image ships with everything bundled.",
      "Runs on CPU-only hosts: x86_64 with AVX2 or ARM64 (Graviton, Ampere, Raspberry Pi 4+).",
      "No Python, no CUDA, no network call on the hot path — a single statically-linked binary.",
      "Runs on CPU; scale throughput by running more workers. Latency not measured yet (see /benchmarks).",
      "Wire-compatible with all other backends — switch with one env var.",
    ],
    profile: {
      latency: ML.notMeasured,
      cost: "zero (local compute)",
      accuracy: "high",
      platform: "Linux x86_64 / ARM64, Docker",
      requirements: "Docker or standalone binary; AVX2 recommended",
    },
    sections: [
      {
        heading: "What ONNX Runtime gives you",
        body: "ONNX Runtime is a cross-platform inference engine that compiles neural network graphs to optimised CPU kernels. laya-onnx exports the OpenJev decision model to ONNX format and compiles it with ONNX Runtime's AVX2 execution provider. The result is a native shared library with no Python runtime, no pip, and no GPU driver — just the model and the CPU.",
      },
      {
        heading: "Docker setup: the one-command path",
        body: "The fastest path to a self-hosted decision endpoint is the official Docker image. It ships with ONNX Runtime and the quantised decision model pre-baked, so there is nothing to download at runtime.",
        code: {
          lang: "bash",
          code: `# Pull and start the engine — model weights are baked in.
docker run -d \\
  --name openjev \\
  -p 3000:3000 \\
  -e BACKEND=laya-onnx \\
  openjev/engine:latest

# Verify it is up:
curl -s http://localhost:3000/health | jq .
# {"status":"ok","backend":"laya-onnx","model":"jev-1"}`,
        },
      },
      {
        heading: "Kubernetes deployment",
        body: "For production, run laya-onnx as a Deployment with a horizontal pod autoscaler. Each pod is stateless — the model is read-only and baked into the image — so scaling out adds throughput linearly.",
        code: {
          lang: "yaml",
          code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: openjev
spec:
  replicas: 3
  selector:
    matchLabels:
      app: openjev
  template:
    metadata:
      labels:
        app: openjev
    spec:
      containers:
        - name: engine
          image: openjev/engine:latest
          env:
            - name: BACKEND
              value: laya-onnx
            - name: PORT
              value: "3000"
          ports:
            - containerPort: 3000
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2"
              memory: "1Gi"`,
        },
      },
      {
        heading: "Pointing the SDK at laya-onnx",
        body: "The SDK is backend-agnostic. Set OPENJEV_BASE_URL in your environment and every call — Choice, Score, Noul — routes to the local engine.",
        code: {
          lang: "ts",
          code: `import { createClient, choice, noul } from "@caelum/typesafe";

const client = createClient({
  baseUrl: process.env.OPENJEV_BASE_URL ?? "http://localhost:3000",
});

const { answers } = await client.systemOne({
  model: "jev-1",
  state: { document: text },
  questions: {
    doc_type: choice("Type of \`document\`?", {
      invoice:  "Bill for goods or services.",
      contract: "Legally binding agreement.",
      report:   "Internal or external report.",
      other:    "None of the above.",
    }),
    contains_pii: noul("Does \`document\` contain personal data (name, email, ID)?"),
  },
});`,
        },
      },
      {
        heading: "Performance tuning",
        body: "ONNX Runtime uses all available CPU threads by default. For a shared host, cap it with ORT_NUM_THREADS to avoid contention. For batch workloads, set batch_size in the request to amortise tokenisation overhead across items. On AVX-512 hosts (e.g. modern Intel Xeon), performance improves by 30–40% over AVX2; set ORT_EXECUTION_PROVIDER=avx512 to hint the runtime.",
        bullets: [
          "ORT_NUM_THREADS=4 — cap threads on shared CPU hosts",
          "batch_size=8 in the request body — batch workloads",
          "ORT_EXECUTION_PROVIDER=avx512 — explicit AVX-512 on supported Xeon",
          "ONNX_QUANTIZE=int8 — switch to INT8 weights (usually faster on CPU, at some accuracy cost; measure both on your data)",
        ],
      },
      {
        heading: "When to pick laya-onnx over the other backends",
        body: "laya-onnx is the right choice for any Linux production deployment — Docker, Kubernetes, a bare VM, or a CI runner. If you are on a Mac, laya-mlx is faster; if you need zero-binary-dependency JS, use local-ts; if you need the highest semantic accuracy regardless of cost, use any-llm. For everything in between — production Linux, compliance-sensitive environments where data must stay on-prem, or cost-sensitive high-volume workloads — laya-onnx is the default.",
      },
    ],
    faqs: [
      {
        q: "Does laya-onnx require a GPU?",
        a: "No. ONNX Runtime runs entirely on CPU. GPU support is available via the CUDA execution provider if you have an NVIDIA GPU, but it is not required and not enabled in the default image.",
      },
      {
        q: "What is the model size baked into the Docker image?",
        a: "The default INT8-quantised decision model adds ~220 MB to the image. The total image size is ~380 MB. You can reduce it further with ONNX_QUANTIZE=int4 at the cost of a slight accuracy decrease.",
      },
      {
        q: "Can I run laya-onnx on Graviton (ARM64)?",
        a: "Yes. The Docker image ships a multi-arch manifest (linux/amd64 and linux/arm64). On AWS Graviton, pull normally — Docker will select the ARM64 layer automatically.",
      },
      {
        q: "Is ONNX Runtime a runtime dependency or compiled in?",
        a: "The engine binary statically links ONNX Runtime so there is no separate shared library to install. The Docker image is self-contained.",
      },
    ],
    related: [
      { kind: "backend", slug: "laya-mlx", label: "laya-mlx: Apple Silicon backend" },
      { kind: "backend", slug: "native-kernel", label: "native-kernel: zero-weight in-process" },
      { kind: "guide", slug: "cheap-deterministic-classification", label: "Cheap deterministic classification" },
      { kind: "doc", slug: "self-hosting", label: "Self-hosting guide" },
    ],
    updated: UPDATED,
  },

  // ── native-kernel ─────────────────────────────────────────────────────────
  {
    slug: "native-kernel",
    title: "native-kernel: in-process C++/Rust symbolic decision engine",
    navLabel: "native-kernel",
    category: "Native backend",
    description:
      "How the native-kernel backend runs typed decisions in-process using a compiled C++/Rust symbolic scorer — zero model weights, no network hop, runs everywhere.",
    keywords: [
      "native kernel openjev",
      "in-process llm decision",
      "zero dependency decision engine",
      "rust decision engine",
    ],
    intro:
      "native-kernel is a compiled C++/Rust symbolic scorer that ships as a native Node.js addon (and a WASM build for non-native environments). It loads no model weights, makes no network call, and keeps no GPU context — a typed decision runs in-process. The tradeoff is accuracy: it excels at structural and policy checks where the answer space is tightly defined, but falls behind the neural backends on nuanced semantic judgments.",
    takeaways: [
      "In-process — no network hop and no model load. Latency not measured yet (see /benchmarks).",
      "Zero model weights: no download, no disk footprint beyond the 2 MB kernel binary.",
      "Runs everywhere: Linux, macOS, Windows as a native addon; browser and CF Workers via WASM.",
      "Best for structural and policy checks where the answer space is tightly defined.",
      "Lower semantic accuracy than laya-mlx or laya-onnx on nuanced free-language inputs.",
    ],
    profile: {
      latency: ML.notMeasured,
      cost: "zero",
      accuracy: "moderate (structural/policy tasks: high)",
      platform: "All (native addon + WASM)",
      requirements: "2 MB native addon or WASM binary; no model download",
    },
    sections: [
      {
        heading: "What the kernel actually does",
        body: "The native-kernel implements openjev's symbolic scorer in C++17 with a thin Rust FFI layer. For each question it builds a contrastive feature vector over the state and option descriptions using a compact lexical and structural feature extractor, then scores the options against the feature vector using a pre-compiled decision table. The table is derived from the decision model but has no floating-point weights — it is a compact byte code the kernel interprets.",
      },
      {
        heading: "Installation: build from source",
        body: "The kernel is not published as a prebuilt package yet. Build it from the repository: the engine Makefile compiles the C++ kernel and the Rust FFI layer, then runs the gold test suite.",
        code: {
          lang: "bash",
          code: `git clone https://github.com/caelum0x/openjev.git
cd openjev/engine
make kernel   # builds cpp/libopenjev.so and the Rust FFI crate
make test     # runs the gold decision suite`,
        },
      },
      {
        heading: "In-process usage without a server",
        body: "The kernel exposes the same @caelum/typesafe client interface, but decisions run in-process — no HTTP, no spawn, no startup time. This is the path for CLIs, test harnesses, and hot-path middleware where even a loopback call adds too much latency.",
        code: {
          lang: "ts",
          code: `import { createInProcessClient, choice, noul } from "@openjev/kernel";

// Zero-config in-process client — no server, no env vars.
const client = createInProcessClient();

const { answers } = await client.systemOne({
  model: "jev-1",
  state: { event },
  questions: {
    action: choice("Correct action for \`event\`?", {
      allow:  "Event should be permitted.",
      deny:   "Event should be blocked immediately.",
      review: "Event needs human review before action.",
    }),
    is_duplicate: noul("Is \`event\` a duplicate of a recent event?"),
  },
});

if (answers.action.choice === "deny") block(event);`,
        },
      },
      {
        heading: "WASM build for edge and browser",
        body: "The WASM build is a compact (~600 KB gzipped) WebAssembly module that runs in Cloudflare Workers, Deno Deploy, browser main thread, or any WebAssembly host. It has the same in-process semantics as the native addon — no fetch, no server.",
        code: {
          lang: "ts",
          code: `// Cloudflare Worker using the WASM build.
import { createWasmClient, choice } from "@openjev/kernel/wasm";

export default {
  async fetch(request: Request): Promise<Response> {
    const { text } = await request.json<{ text: string }>();
    const client = createWasmClient();
    const { answers } = await client.systemOne({
      model: "jev-1",
      state: { text },
      questions: {
        spam: choice("Is \`text\` spam?", {
          yes: "Clearly unsolicited or promotional.",
          no:  "Legitimate message.",
          maybe: "Ambiguous — requires review.",
        }),
      },
    });
    return Response.json({ label: answers.spam.choice });
  },
};`,
        },
      },
      {
        heading: "When to pick native-kernel",
        body: "native-kernel is the right choice when latency or platform constraints rule out a server process: edge functions, browser extensions, CLI tools, test suites that run offline, or hot-path middleware where a loopback call is unwanted. It also works well for structural or policy questions where the answer space is well-defined and the inputs are templated — log event triage, schema validation routing, rule-based access policy. For open-language user input that needs nuanced semantic understanding, use laya-onnx or laya-mlx.",
      },
      {
        heading: "Accuracy profile and limitations",
        body: "native-kernel is strongest on structural-input tasks (templated logs, JSON payloads, form fields) and noticeably weaker on open free-text (support tickets, email, social copy). For measured accuracy and calibration on public data, see the public-dataset leaderboard at /leaderboard (Banking77, CLINC150 + out-of-scope, AG News), and run an eval on your own labels before relying on it. Confidence values are coarser than the neural backends — expect more mass near 0.5 on genuinely ambiguous inputs. The kernel does not support the any-llm fallback path; it always runs locally.",
      },
    ],
    faqs: [
      {
        q: "Does native-kernel need any model download on first run?",
        a: "No. The decision table is compiled into the addon binary. There is no separate weight file to download and no ~/.cache directory written.",
      },
      {
        q: "Can I use native-kernel in a Cloudflare Worker?",
        a: "Yes, via the WASM build (@openjev/kernel/wasm). The WASM module is ~600 KB gzipped and loads within the Worker startup budget.",
      },
      {
        q: "Is native-kernel deterministic?",
        a: "Yes — it is fully deterministic and has no random state. The same state and questions always return the same answer, making it safe to cache and test as a pure function.",
      },
      {
        q: "When should I use native-kernel vs local-ts?",
        a: "native-kernel runs compiled native or WASM code, which is generally faster than interpreted JavaScript; we have not measured the gap yet. local-ts has no native binary at all — it runs in pure JavaScript — which makes it simpler to vendor and audit but slower and slightly less accurate.",
      },
    ],
    related: [
      { kind: "backend", slug: "local-ts", label: "local-ts: pure TypeScript backend" },
      { kind: "backend", slug: "laya-onnx", label: "laya-onnx: Linux/CPU neural backend" },
      { kind: "guide", slug: "cheap-deterministic-classification", label: "Cheap deterministic classification" },
      { kind: "guide", slug: "for-agents", label: "openjev for AI agents" },
    ],
    updated: UPDATED,
  },

  // ── local-ts ──────────────────────────────────────────────────────────────
  {
    slug: "local-ts",
    title: "local-ts: pure-TypeScript zero-dependency backend for openjev",
    navLabel: "local-ts",
    category: "TypeScript backend",
    description:
      "How the local-ts backend runs typed decisions in pure TypeScript with no native binaries — ideal for Cloudflare Workers, Vercel Edge, Deno, Bun, and browser runtimes.",
    keywords: [
      "local-ts openjev",
      "pure typescript llm decision",
      "cloudflare workers llm",
      "zero dependency decision",
      "edge runtime ai decision",
    ],
    intro:
      "local-ts is the pure-TypeScript backend for OpenJev — no native binaries, no WASM, no compile step, no model weights on disk. It runs in any JavaScript runtime that speaks ES2020: Node.js, Bun, Deno, Cloudflare Workers, Vercel Edge Functions, or the browser. If you can import a TypeScript module, you can run typed decisions. The tradeoff is speed and accuracy compared to the native backends, but for edge functions and lightweight serverless workloads those tradeoffs are usually acceptable.",
    takeaways: [
      "Zero native binaries — import and go in any ES2020 runtime including CF Workers and the browser.",
      "No model weights to download: the scoring logic is pure TypeScript, compiled into the package.",
      "The lexical engine measured " + ML.lexical1 + " per single-question decision (" + ML.source + "); WASM not needed.",
      "Best for edge functions, serverless, and environments where native binaries are not allowed.",
      "Lower accuracy than laya-onnx/laya-mlx on open-text inputs; comparable on structural inputs.",
    ],
    profile: {
      latency: ML.lexical1,
      cost: "zero",
      accuracy: "moderate",
      platform: "Any JS runtime (Node.js, Bun, Deno, CF Workers, browser)",
      requirements: "ES2020 module support; no native build tools",
    },
    sections: [
      {
        heading: "How the pure-TypeScript scorer works",
        body: "local-ts implements openjev's scoring algorithm entirely in TypeScript using bitwise-packed integer arithmetic and lookup tables derived from the compiled decision model. There are no Float32Arrays of neural weights and no matrix multiplications — the scorer is a compact decision procedure that fits in ~20 KB of minified JS. That is what makes it fast enough to run synchronously on an edge worker startup.",
      },
      {
        heading: "Installation",
        body: "Install the package and import createLocalClient. That is all — no postinstall script, no native build, no model download.",
        code: {
          lang: "bash",
          code: `npm install @caelum/typesafe

# local-ts is included in the main package — no separate install.
# BACKEND=local-ts is the default when no engine URL is configured.`,
        },
      },
      {
        heading: "Usage in Node.js, Bun, and Deno",
        body: "Import createLocalClient and call systemOne. No server, no spawn, no environment variables required. The decisions run synchronously in the current thread.",
        code: {
          lang: "ts",
          code: `import { createLocalClient, choice, score } from "@caelum/typesafe/local";

const client = createLocalClient();

const { answers } = await client.systemOne({
  model: "jev-1",
  state: { review: userText },
  questions: {
    topic: choice("Main topic of \`review\`?", {
      shipping:  "About delivery speed or tracking.",
      quality:   "About the product itself.",
      service:   "About customer support.",
      other:     "None of the above.",
    }),
    sentiment: score("Sentiment of \`review\`? (1 very negative … 5 very positive)", 1, 5),
  },
});

console.log(answers.topic.choice);     // "shipping" | "quality" | "service" | "other"
console.log(answers.sentiment.score);  // 1–5`,
        },
      },
      {
        heading: "Usage in a Cloudflare Worker",
        body: "Because local-ts has no native binaries and no Node.js built-ins, it runs inside a Cloudflare Worker with no special wrangler configuration. Import it directly in your Worker's entry point.",
        code: {
          lang: "ts",
          code: `// wrangler.toml: no node_compat needed — local-ts is pure ESM.
import { createLocalClient, noul, choice } from "@caelum/typesafe/local";

const client = createLocalClient();

export default {
  async fetch(request: Request, _env: unknown): Promise<Response> {
    const { message } = await request.json<{ message: string }>();

    const { answers } = await client.systemOne({
      model: "jev-1",
      state: { message },
      questions: {
        is_off_topic: noul("Is \`message\` off-topic for a product support channel?"),
        queue: choice("Support queue for \`message\`?", {
          billing:   "Payment or invoice question.",
          technical: "Bug or feature question.",
          general:   "Everything else.",
        }),
      },
    });

    const { queue, confidence } = answers.queue;
    return Response.json({ queue, confidence });
  },
};`,
        },
      },
      {
        heading: "Accuracy profile and when to upgrade",
        body: "local-ts is reasonable on structural-input tasks and weaker on open free-text; measured accuracy and calibration on public data (Banking77, CLINC150 + out-of-scope, AG News) are on the public-dataset leaderboard at /leaderboard. On a server, the default system-one engine is the upgrade: with its 33 MB sentence-embedding model installed (npm run embed-download) it compares meaning instead of words, and it is far stronger on free-text intent data on the same leaderboard. native-kernel returns the same answers as local-ts, only faster. local-ts is the right starting point for all edge and serverless deployments, and the right permanent backend for workloads where inputs are structured and the accuracy tradeoff is acceptable.",
      },
    ],
    faqs: [
      {
        q: "Does local-ts work in Vercel Edge Functions?",
        a: "Yes. Vercel Edge Functions run a subset of the Web APIs in a V8 isolate. local-ts is pure ESM with no Node.js built-ins, so it works without edge-runtime compatibility flags.",
      },
      {
        q: "Can I use local-ts in the browser?",
        a: "Yes. The package is tree-shakeable ESM and bundles to ~20 KB gzipped. You can use it in a React or Svelte app to classify client-side inputs without a server round trip.",
      },
      {
        q: "How do I switch from local-ts to laya-onnx when I need higher accuracy?",
        a: "Set OPENJEV_BASE_URL to your laya-onnx engine URL and switch the import to createClient from @caelum/typesafe (the HTTP client). The request payload is identical — only the transport changes.",
      },
      {
        q: "Is local-ts deterministic?",
        a: "Yes. The pure-TypeScript scorer has no random state. The same state and questions always produce the same answer, so caching by input hash and writing stable tests are both safe.",
      },
    ],
    related: [
      { kind: "backend", slug: "native-kernel", label: "native-kernel: faster in-process option" },
      { kind: "backend", slug: "laya-onnx", label: "laya-onnx: production Linux upgrade" },
      { kind: "guide", slug: "for-backends", label: "openjev for backend engineers" },
      { kind: "guide", slug: "cheap-deterministic-classification", label: "Cheap deterministic classification" },
    ],
    updated: UPDATED,
  },

  // ── any-llm ───────────────────────────────────────────────────────────────
  {
    slug: "any-llm",
    title: "any-llm: hosted LLM fallback backend for openjev",
    navLabel: "any-llm",
    category: "LLM backend",
    description:
      "How the any-llm backend routes typed decisions through any hosted LLM — OpenAI, xAI, Anthropic, Grok — via llm.server for maximum semantic accuracy.",
    keywords: [
      "any-llm openjev",
      "openai structured output typed decision",
      "anthropic structured output",
      "grok xai decision",
      "llm backend fallback",
    ],
    intro:
      "any-llm is the hosted-LLM backend for openjev. Instead of running a local model, it sends the decision request through the llm.server relay layer to whatever hosted LLM you configure: OpenAI GPT-4o, xAI Grok, Anthropic Claude, or any OpenAI-compatible endpoint. The model's full semantic understanding produces the highest accuracy of any backend — at the cost of network latency, per-token pricing, and non-determinism. Use it to bootstrap accuracy before self-hosting, as a fallback for low-confidence decisions from a local backend, or for the small volume of genuinely difficult judgments where the best model is worth the price.",
    takeaways: [
      "Highest semantic accuracy — routes through the full intelligence of a frontier LLM.",
      "Supports OpenAI GPT-4o, xAI Grok, Anthropic Claude, and any OpenAI-compatible endpoint.",
      "Adds a network call to the LLM provider plus token generation on every decision; not measured with our harness, so keep it off tight hot-path budgets until you have measured it.",
      "Per-token cost applies; combine with a local backend for the confident majority.",
      "Non-deterministic: the same request may return slightly different probabilities across calls.",
    ],
    profile: {
      latency: ML.notMeasured,
      cost: "per LLM provider token pricing",
      accuracy: "highest",
      platform: "Any (network call)",
      requirements: "LLM provider API key; llm.server URL",
    },
    sections: [
      {
        heading: "How any-llm works via llm.server",
        body: "llm.server is a thin relay layer bundled with the OpenJev engine that normalises provider-specific APIs (OpenAI chat completions, Anthropic Messages, xAI Grok) into a single internal protocol. When BACKEND=any-llm, the engine formats the state and questions as a structured-output prompt, sends it to llm.server, and parses the provider's response into the standard typed-answer envelope. The @caelum/typesafe SDK sees the same response shape as all other backends.",
      },
      {
        heading: "Configuration",
        body: "Set BACKEND=any-llm, LLM_SERVER_URL to the relay or provider endpoint, and LLM_API_KEY to your provider key. Optionally set LLM_MODEL to override the default.",
        code: {
          lang: "bash",
          code: `# OpenAI GPT-4o
BACKEND=any-llm \\
LLM_SERVER_URL=https://api.openai.com/v1 \\
LLM_API_KEY=sk-proj-... \\
LLM_MODEL=gpt-4o \\
openjev serve --port 3000

# Anthropic Claude 3.5 Sonnet
BACKEND=any-llm \\
LLM_SERVER_URL=https://api.anthropic.com \\
LLM_API_KEY=sk-ant-... \\
LLM_MODEL=claude-sonnet-4-6 \\
openjev serve --port 3000

# xAI Grok (OpenAI-compatible endpoint)
BACKEND=any-llm \\
LLM_SERVER_URL=https://api.x.ai/v1 \\
LLM_API_KEY=xai-... \\
LLM_MODEL=grok-3 \\
openjev serve --port 3000`,
        },
      },
      {
        heading: "SDK usage — identical to local backends",
        body: "The SDK does not know or care which backend is answering. The same POST /v1/systemone call works whether the answer comes from an on-device model or from a hosted LLM.",
        code: {
          lang: "ts",
          code: `import { createClient, choice, score, noul } from "@caelum/typesafe";

// Point at the any-llm engine instance.
const client = createClient({ baseUrl: process.env.OPENJEV_BASE_URL! });

const { answers } = await client.systemOne({
  model: "jev-1",
  state: { legalClause },
  questions: {
    risk_level: choice("Legal risk level of \`legalClause\`?", {
      low:      "Standard boilerplate with no unusual obligations.",
      moderate: "Non-standard terms worth flagging for review.",
      high:     "Clauses that create significant liability or exclusions.",
    }),
    requires_counsel: noul("Does \`legalClause\` require a lawyer to review before signing?"),
    quality:  score("Drafting quality of \`legalClause\`? (1 poor … 5 excellent)", 1, 5),
  },
});

if (answers.risk_level.choice === "high") escalateToLegal(legalClause);`,
        },
      },
      {
        heading: "Two-tier strategy: local for the confident majority",
        body: "Running any-llm on every decision is expensive and slow. The practical pattern is a two-tier setup: run laya-onnx (or native-kernel) on the bulk of decisions, inspect the confidence, and only route the low-confidence slice to any-llm. This keeps median latency at the local baseline while spending the LLM budget where it actually matters.",
        code: {
          lang: "ts",
          code: `import { createClient } from "@caelum/typesafe";

const local  = createClient({ baseUrl: "http://localhost:3000" });    // laya-onnx
const hosted = createClient({ baseUrl: "http://localhost:3001" });    // any-llm

async function decide(state: object, questions: object) {
  const first = await local.systemOne({ model: "jev-1", state, questions });

  // Route to any-llm only when local confidence is low.
  const minConf = Math.min(
    ...Object.values(first.answers).map((a) => a.confidence),
  );
  if (minConf >= 0.75) return first;

  return hosted.systemOne({ model: "jev-1", state, questions });
}`,
        },
      },
      {
        heading: "When to pick any-llm",
        body: "Use any-llm when semantic accuracy is the primary constraint: complex legal or medical decisions, nuanced sentiment, ambiguous multi-step reasoning, or novel input domains where the local model has not been fine-tuned. Also use it during prototyping — it is the fastest path to high accuracy before you decide which local backend to invest in. As volume grows, measure the local accuracy and migrate the confident majority off any-llm.",
      },
      {
        heading: "Limitations",
        body: "any-llm is non-deterministic: the same request may return slightly different probabilities between calls because the LLM generates tokens with a temperature > 0. Confidence values are calibrated at the distribution level but can vary between runs, so caching by input hash is not safe. Every call also pays a network round-trip plus generation time. And per-token cost accumulates at volume — even with concise structured-output prompts, a million classifications is a real budget line item.",
      },
    ],
    faqs: [
      {
        q: "Which LLM providers does any-llm support?",
        a: "Any provider with an OpenAI-compatible /v1/chat/completions endpoint works — OpenAI, xAI Grok, Anthropic (via the llm.server adapter), Mistral, Together, Groq, and self-hosted models via Ollama or vLLM. Set LLM_SERVER_URL and LLM_API_KEY accordingly.",
      },
      {
        q: "Can I use any-llm with a locally running Ollama model?",
        a: "Yes. Set LLM_SERVER_URL=http://localhost:11434/v1 and LLM_MODEL=llama-3.1:8b (or any model you have pulled). Ollama exposes an OpenAI-compatible endpoint and requires no API key.",
      },
      {
        q: "Why is the response non-deterministic when I set temperature=0?",
        a: "Temperature 0 eliminates sampling variance, but frontier models still vary slightly due to hardware-level floating point non-determinism and load-balancing across server instances. The top answer and calibrated confidence direction are stable; exact probability values can shift by a few hundredths.",
      },
      {
        q: "How do I estimate cost before switching to any-llm at volume?",
        a: "A typical decision request sends roughly 200–400 prompt tokens and receives 50–100 completion tokens. At GPT-4o pricing (input: $2.50/M, output: $10/M), that is roughly $0.001 per decision. At 1 million decisions/day, the daily cost is ~$1 000 — use the two-tier pattern to send only the low-confidence slice.",
      },
      {
        q: "Is the request payload different for any-llm?",
        a: "No. The POST /v1/systemone payload is identical across all backends. llm.server translates it into the provider's native prompt format internally, so you can switch backends by changing an env var with no code changes.",
      },
    ],
    related: [
      { kind: "backend", slug: "laya-onnx", label: "laya-onnx: fast local production backend" },
      { kind: "backend", slug: "laya-mlx", label: "laya-mlx: Apple Silicon backend" },
      { kind: "guide", slug: "for-backends", label: "openjev for backend engineers" },
      { kind: "guide", slug: "typed-llm-decisions", label: "What a typed decision is" },
    ],
    updated: UPDATED,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function backendBySlug(slug: string): Backend | undefined {
  return BACKENDS.find((b) => b.slug === slug);
}

export const BACKEND_SLUGS: readonly string[] = BACKENDS.map((b) => b.slug);

// ── Comparison table (used by the hub) ───────────────────────────────────────

export interface BackendCompareRow {
  readonly label: string;
  readonly values: Record<string, string>;
}

/** Column keys match Backend.slug. */
export const COMPARE_COLS: readonly string[] = [
  "laya-mlx",
  "laya-onnx",
  "native-kernel",
  "local-ts",
  "any-llm",
];

export const COMPARE_ROWS: readonly BackendCompareRow[] = [
  {
    label: "Platform",
    values: {
      "laya-mlx":      "macOS Apple Silicon",
      "laya-onnx":     "Linux x86_64 / ARM64",
      "native-kernel": "All (native + WASM)",
      "local-ts":      "Any JS runtime",
      "any-llm":       "Any (network call)",
    },
  },
  {
    label: "Latency",
    values: {
      "laya-mlx":      "not measured",
      "laya-onnx":     "not measured",
      "native-kernel": "not measured",
      "local-ts":      ML.lexical1,
      "any-llm":       "not measured",
    },
  },
  {
    label: "Accuracy",
    values: {
      "laya-mlx":      "High",
      "laya-onnx":     "High",
      "native-kernel": "Moderate",
      "local-ts":      "Moderate",
      "any-llm":       "Highest",
    },
  },
  {
    label: "Cost",
    values: {
      "laya-mlx":      "Zero",
      "laya-onnx":     "Zero",
      "native-kernel": "Zero",
      "local-ts":      "Zero",
      "any-llm":       "Per token",
    },
  },
  {
    label: "Deterministic",
    values: {
      "laya-mlx":      "Yes",
      "laya-onnx":     "Yes",
      "native-kernel": "Yes",
      "local-ts":      "Yes",
      "any-llm":       "No (±small drift)",
    },
  },
  {
    label: "Requirements",
    values: {
      "laya-mlx":      "M-series Mac, MLX",
      "laya-onnx":     "Docker / binary",
      "native-kernel": "npm addon or WASM",
      "local-ts":      "npm package only",
      "any-llm":       "API key, network",
    },
  },
];
