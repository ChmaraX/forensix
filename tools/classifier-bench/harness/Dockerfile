# classifier-bench harness — two-phase Docker (ChmaraX/forensix#137)
#
# Build with context = tools/classifier-bench/ (the parent of this file):
#   docker build -f harness/Dockerfile -t classifier-bench:arm64 .
#
# Phase A (network on):        node download.js    fetch + verify artifacts, compile UT1
# Phase B (--network none):    node run_bench.js   run every candidate, fully offline
#
# Reproducibility, after the audit round:
#   * Base image pinned by multi-arch manifest digest, not a floating tag.
#   * package-lock.json IS copied and `npm ci` is used, so the tokenizer version
#     cannot float between builds. The spike proved an unpinned resolution pulls a
#     second ONNX Runtime with the same SONAME and breaks import at load time.
FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

WORKDIR /app

COPY harness/package.json harness/package-lock.json ./
RUN npm ci --ignore-scripts

COPY harness/download.js harness/run_bench.js harness/make_leaderboard.js harness/compare_runs.js ./
COPY harness/models.js harness/expected_artifacts.json harness/ut1_category_map.json ./
COPY harness/lib ./lib
COPY harness/candidates ./candidates
COPY harness/test ./test
COPY taxonomy.json /app-root/taxonomy.json
COPY fixture /app-root/fixture

ENV BENCH_ROOT=/app-root

# Artifacts and results are mounted at runtime.
# Phase A: docker run -v artifacts:/artifacts image node download.js
# Phase B: docker run --network none -v artifacts:/artifacts:ro -v results:/results image node run_bench.js
