# ── potion-node-spike ──────────────────────────────────────────────────────
# Phase A (with network): download model artifacts
# Phase B (--network none): tokenize + embed, fully offline
# ──────────────────────────────────────────────────────────────────────────

FROM node:22-slim

WORKDIR /app

# Copy package manifests only (layer-cache friendly)
COPY package.json package-lock.json ./

# MANDATORY per spike spec: --ignore-scripts skips onnxruntime-node's
# postinstall hook.  The onnxruntime binary must load from its bundled
# optional-dependency package without any postinstall setup.
RUN npm ci --ignore-scripts

# Application scripts
COPY download.js embed.js ./

# Artifacts are mounted at runtime (not baked into the image)
# Phase A: docker run -v artifacts:/artifacts image node download.js
# Phase B: docker run --network none -v artifacts:/artifacts image node embed.js
