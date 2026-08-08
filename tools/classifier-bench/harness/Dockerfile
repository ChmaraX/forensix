# classifier-bench harness — two-phase Docker (ChmaraX/forensix#137)
# Build with context = tools/classifier-bench/ (the parent of this file):
#   docker build -f harness/Dockerfile -t classifier-bench:latest .
# Phase A (network): download + hash model artifacts
# Phase B (--network none): run every candidate, fully offline
FROM node:22-slim

WORKDIR /app

COPY harness/package.json ./
RUN npm install --ignore-scripts

COPY harness/download.js harness/run_bench.js ./
COPY harness/lib ./lib
COPY harness/candidates ./candidates
COPY taxonomy.json /app-root/taxonomy.json
COPY fixture /app-root/fixture

ENV BENCH_ROOT=/app-root

# Artifacts and results are mounted at runtime.
# Phase A: docker run -v artifacts:/artifacts image node download.js
# Phase B: docker run --network none -v artifacts:/artifacts:ro -v results:/results image node run_bench.js
