# Self-hosting OpenJev

**OpenJev** self-hosts as two containers: the **Node service** (the typed-decision
API + playground/docs UI) and a **laya-onnx sidecar** (the CPU neural backend). The Node
service runs the pure-TS decision engine out of the box, so it works even before any model
weights or provider keys are configured.

---

## Quickstart (Docker Compose)

```bash
cp .env.example .env          # optional — nothing is required to boot
docker compose up --build
```

Then open **http://localhost:3000**.

That's it. Compose builds both images, starts the laya-onnx sidecar (which downloads its
weights on first boot into a persistent `laya-models` volume), and starts the Node service
wired to the sidecar via `LAYA_ENGINE_URL=http://laya-onnx:8092`.

- API: `POST http://localhost:3000/v1/systemone`
- Playground / docs / keys / usage UI: `http://localhost:3000`

Stop with `Ctrl-C`; tear down with `docker compose down` (add `-v` to also drop the
downloaded model weights).

### Durable database (optional)

By default the Node service uses an in-memory PGLite database — data resets on restart.
For persistence, uncomment the `db` (Postgres) service and the `pgdata` volume in
`docker-compose.yml`, pick your own strong password, and set both in `.env`
(the compose file does not publish Postgres's port to the host — `db` is only
reachable from the other containers on the internal compose network):

```bash
POSTGRES_PASSWORD=<a real secret, e.g. `openssl rand -hex 24`>
DATABASE_URL=postgresql://openjev:<same POSTGRES_PASSWORD>@db:5432/openjev
```

Never leave `POSTGRES_PASSWORD`/`DATABASE_URL` at the old `openjev`/`openjev` default —
that credential pair is public (it was this project's placeholder) and must not be used
on any host reachable by anyone else. Migrations run automatically at container start.

### LLM escalation (optional)

To let hard decisions escalate to a hosted model, set a provider key in `.env`:

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Supported providers: `openai`, `xai` (Grok), `anthropic` (Claude). With no key set, the
service always answers from the local engine.

---

## Running without Docker (Node + CLI)

The package ships an `openjev` CLI (`bin` in `package.json`) with two subcommands.

```bash
# 1. Install deps and build the standalone Node server (.output/server/index.mjs)
npm ci
NITRO_PRESET=node-server npm run build     # or: npm run build:node

# 2. (optional) Produce the neural model and start the sidecar, health-gated.
#    `laya-sidecar` resolves the backend (mlx on Apple Silicon, onnx elsewhere),
#    downloads/distils the weights if the model dir is missing, launches
#    scripts/laya_sidecar.py, and BLOCKS until GET /health reports ok — so you
#    get an explicit PASS/FAIL, never a process that started but can't serve.
#    The onnx sidecar runs onnxruntime + tokenizers + numpy on a LOCAL model dir.
#    There is NO public Laya ONNX checkpoint (laya-mlx exports MLX only), so the
#    default onnx path DISTILS a compact CPU model locally (scripts/laya_distill.py):
#    a frozen MiniLM sentence-encoder + typed Choice/Score/Noul heads, trained on
#    engine/gold.json + synthetic typed-decision data, exported to model.onnx.
pip install onnxruntime tokenizers numpy "torch>=2.5" transformers onnx
LAYA_BACKEND=onnx npm run laya-sidecar                  # download (if needed) + start + health-gate
#    Under the hood laya-sidecar calls laya-download.sh (distils -> ./models/laya-onnx-base)
#    then laya_sidecar.py. To use your own real ONNX export of upstream Laya:
# LAYA_BACKEND=onnx LAYA_ONNX_REPO=youracct/laya-onnx npm run laya-download
#    Or run the pieces by hand:
# LAYA_BACKEND=onnx LAYA_MODEL_PATH=./models/laya-onnx-base python3 scripts/laya_sidecar.py

# 3. Serve the Node service (honors PORT, default 3000). It probes the sidecar
#    via GET /api/v1/status; the playground disables `laya-*` until it is healthy.
npm run serve                               # = openjev serve
```

Verify the wiring end to end:

```bash
curl -s localhost:3000/api/v1/status | jq '.laya, (.models[] | select(.backend=="laya"))'
```

`laya.available: true` means the sidecar is reachable and requests for the
matching `laya-*` model are served by the neural backend. When it is `false`,
the model selector shows `laya-*` as **install**-gated and any request that
still names `laya-*` comes back with an explicit `fallback` object
(`requested` / `served` / `reason`) — never a silent local answer wearing a
`laya-` label.

Once installed globally (`npm link` or `npm i -g`), the same commands are:

```bash
openjev laya-download
openjev serve
```

`openjev serve` starts the built Node server on `PORT` (default 3000), `HOST`
(default 0.0.0.0). `openjev laya-download` fetches Laya weights from Hugging Face,
honoring `LAYA_BACKEND` / `LAYA_MODEL` / `LAYA_DEST`.

---

## Configuration

Every environment variable is documented in [`.env.example`](./.env.example). Nothing is
required to boot. The most relevant knobs:

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` / `HOST` | Node server bind | `3000` / `0.0.0.0` |
| `LAYA_BACKEND` | `mlx` (Apple) or `onnx` (Linux/CPU) | auto |
| `LAYA_ENGINE_URL` | Laya sidecar URL | `http://127.0.0.1:8092` |
| `OPENJEV_ENGINE_URL` | Native C++/Rust engine URL | `http://127.0.0.1:8091` |
| `DATABASE_URL` | Postgres; PGLite fallback if unset | _(unset)_ |
| `LLM_PROVIDER` + `*_API_KEY` | Optional hosted LLM escalation | _(off)_ |
| `VITE_AUTH_ENABLED` / `BETTER_AUTH_SECRET` | Self-host sign-in + signing secret | `false` |
| `OPENJEV_REPORT_SIGNING_SECRET` | HMAC key for signed calibration audit reports (32+ chars; falls back to a key derived from `BETTER_AUTH_SECRET`) | _(unset: reports answer 503)_ |
| `OPENJEV_PUBLIC_RPM_PER_IP` | Keyless requests per minute per client IP on the public demo routes (`/api/v1/cookbooks/*`, `/api/v1/loop`, `/api/v1/compact`); `0` disables | `30` |
| `OPENJEV_PUBLIC_RPM_GLOBAL` | Keyless requests per minute across all IPs on those routes; `0` disables | `600` |
| `OPENJEV_PUBLIC_MAX_BODY_BYTES` | Overrides the per-route JSON body cap on those routes (defaults: 64 KiB cookbooks, 32 KiB loop, 512 KiB compact); over it answers 413 | _(per route)_ |
| `OPENJEV_HOSTED` | Hosted-service mode: enables plan gating **and** applies the public demo limits above to anonymous `POST /api/v1/systemone` and `POST /api/v1/batch` (a batch costs one unit per item; body caps 64 KiB / 256 KiB). Leave unset when self-hosting: those two endpoints stay unlimited | _(unset)_ |
| `OPENJEV_TRUST_PROXY_HEADERS` | Trust `CF-Connecting-IP` / `X-Real-IP` / `X-Forwarded-For` for per-IP bucketing (see below). Set only if a reverse proxy *you* control overwrites these headers before the request reaches this process | _(unset: ignored)_ |

Over a public limit the API answers `429` with `Retry-After`, `RateLimit-*` headers and
`{"error":{"type":"rate_limit","reason":"ip_rate_limit"|"global_rate_limit",...}}`. A
live `ots_live_` API key skips the demo limits and is held to its plan quota instead.
On a self-hosted install anonymous `/api/v1/systemone` and `/api/v1/batch` calls are not
rate limited (the engine is yours); set `OPENJEV_HOSTED=1` if you expose them publicly
and want the same demo windows, or put a proxy limiter in front.

**Per-IP bucketing is untrusted by default.** `CF-Connecting-IP`, `X-Real-IP` and
`X-Forwarded-For` are ordinary, attacker-controlled request headers unless something in
front of this process overwrites them with the real client address first. The stock
`docker compose up --build` path in this repo does **not** put such a proxy in front —
it publishes this process' port directly — so without an explicit opt-in, a caller could
send a fresh `X-Forwarded-For` on every request and mint a brand-new per-IP bucket each
time, defeating the limiter. By default this service therefore ignores those headers and
buckets every caller under a single `"unknown"` key, so only the **global** window
(`OPENJEV_PUBLIC_RPM_GLOBAL`) actually constrains traffic. Only set
`OPENJEV_TRUST_PROXY_HEADERS=1` if you put a real reverse proxy (nginx, Caddy, etc.) in
front that strips any client-supplied value and sets its own `X-Real-IP` /
`X-Forwarded-For` from the TCP connection. The hosted deployment sets `OPENJEV_HOSTED=1`,
which trusts these headers implicitly because it always sits behind Cloudflare.
Windows are in-process (per server instance).

---

## Backends at a glance

- **pure-TS engine** — always on; zero native deps; runs anywhere Node runs.
- **laya-onnx sidecar** — CPU neural backend (this Compose setup). Runs REAL
  `onnxruntime` inference from a local checkpoint (`model.onnx` + tokenizer +
  configs). No model present ⇒ it fails clean (`/health` → `ok:false`, `POST
  /v1/systemone` → `503`) and the Node service falls back to the pure-TS engine.
  It never returns a fabricated decision. Because no public Laya ONNX checkpoint
  exists, `scripts/laya-download.sh` DISTILS one locally
  (`scripts/laya_distill.py`): a MiniLM-L6 (Apache-2.0, ~22.7M params) bidirectional
  encoder with typed Choice/Score/Noul heads, trained on `engine/gold.json` +
  synthetic typed-decision data. The exported `model.onnx` is ~91 MB, CPU-runnable,
  and scores **14/14 on the gold set** — matching the pure-TS baseline. Regenerate
  with `LAYA_FORCE_DISTILL=1 npm run laya-download`. Weights are git-ignored
  (`models/`), never committed.
- **laya-mlx** — Apple Silicon native; run `LAYA_BACKEND=mlx` on macOS. The
  sidecar delegates to the installed `laya_mlx` runtime.
- **native C++/Rust kernel** — in `engine/`; point `OPENJEV_ENGINE_URL` at it if built.
- **LLM escalation** — optional hosted provider for low-confidence decisions.

---

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
