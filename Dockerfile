# syntax=docker/dockerfile:1

###############################################################################
# openjev — Node service (typed-decision API + playground/docs UI)
#
# Builds the TanStack Start app with Nitro's `node-server` preset, producing a
# standalone server at `.output/server/index.mjs`, then runs it via the
# `openjev serve` CLI. The default `system-one` engine runs in-process
# (sentence embeddings via onnxruntime-node, ~33 MB model fetched below); the
# heavy laya-onnx model runtime is a SEPARATE sidecar container (see
# Dockerfile.laya + docker-compose.yml).
###############################################################################

# ---- build stage ------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# Install dependencies against the lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci

# Build the Node-server bundle. DATABASE_URL is intentionally unset here, so the
# build-time migrate step (npm run build -> db:migrate) safely no-ops; real
# migrations run at container start against the configured DATABASE_URL.
# VITE_* values are inlined into the client bundle at build time, so the auth
# toggle must be known here (pass `--build-arg VITE_AUTH_ENABLED=true`).
ARG VITE_AUTH_ENABLED=false
ENV VITE_AUTH_ENABLED=${VITE_AUTH_ENABLED}
COPY . .
RUN NITRO_PRESET=node-server npm run build

# ---- runtime stage ----------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Bring in production node_modules only. onnxruntime-node (optional, for the
# embedding engine) ships binaries for every OS; keep only Linux.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
 && find node_modules/onnxruntime-node/bin -mindepth 2 -maxdepth 2 ! -name linux -exec rm -rf {} + 2>/dev/null || true

# Default System One engine: sentence embeddings (gte-small, int8 ONNX, ~33 MB,
# MIT). Fetched pinned + sha256-verified; build with
# `--build-arg OPENJEV_EMBED=0` to ship only the lexical engine.
ARG OPENJEV_EMBED=1
COPY scripts/embed-download.sh ./scripts/embed-download.sh
RUN if [ "$OPENJEV_EMBED" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
      && bash scripts/embed-download.sh \
      && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*; \
    fi

# Built server output + the bits the CLI and migrator need at runtime.
COPY --from=build /app/.output ./.output
COPY scripts ./scripts
COPY migrations ./migrations

# Register the `openjev` bin on PATH.
RUN npm link 2>/dev/null || true

EXPOSE 3000
# Migrate (no-op without DATABASE_URL) then serve.
CMD ["sh", "-c", "node scripts/migrate.mjs; node scripts/cli.mjs serve"]
