#!/usr/bin/env bash
# Reproduce the exploratory reduced-category run for #137.
# Phase A has network access and downloads two pinned models.
# Phase B runs three separate processes with --network none.
set -euo pipefail

PLATFORM="${PLATFORM:-linux/arm64}"
ARCH_TAG="${ARCH_TAG:-arm64}"
IMAGE="${IMAGE:-classifier-bench:reduced-$ARCH_TAG}"
ARTIFACTS_VOLUME="${ARTIFACTS_VOLUME:-bench-reduced-artifacts-v1}"
RESULTS_VOLUME="${RESULTS_VOLUME:-bench-reduced-results-v1}"
RUN_TAGS="${RUN_TAGS:-main det1 det2}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH="$(cd "$HERE/.." && pwd)"
OUT="$BENCH/results/reduced"
cd "$BENCH"

node scripts/make_reduced_fixture.js

echo "==> Build $IMAGE for $PLATFORM"
docker build --platform "$PLATFORM" -f harness/Dockerfile -t "$IMAGE" .
IMAGE_DIGEST="$(docker image inspect --format '{{.Id}}' "$IMAGE")"

# These volumes belong only to this reduced run. Remove stale files before use.
docker volume rm -f "$ARTIFACTS_VOLUME" "$RESULTS_VOLUME" >/dev/null 2>&1 || true
docker volume create "$ARTIFACTS_VOLUME" >/dev/null
docker volume create "$RESULTS_VOLUME" >/dev/null

echo "==> Phase A: download and verify Potion 8M and BGE Micro"
docker run --rm --platform "$PLATFORM" \
  -v "$ARTIFACTS_VOLUME":/artifacts \
  -e ARTIFACTS_DIR=/artifacts \
  "$IMAGE" node download_reduced.js

for tag in $RUN_TAGS; do
  echo "==> Phase B: $tag (--network none)"
  docker run --rm --platform "$PLATFORM" --network none \
    -v "$ARTIFACTS_VOLUME":/artifacts:ro \
    -v "$RESULTS_VOLUME":/results \
    -e ARTIFACTS_DIR=/artifacts \
    -e RESULTS_DIR=/results \
    -e RUN_TAG="$tag" \
    -e IMAGE_DIGEST="$IMAGE_DIGEST" \
    "$IMAGE" node run_reduced.js
done

echo "==> Tests"
docker run --rm --platform "$PLATFORM" --network none \
  -v "$RESULTS_VOLUME":/results:ro \
  -e REDUCED_RESULTS_DIR=/results \
  "$IMAGE" node --test \
    test/reduced.test.js test/metrics.test.js test/fixture.test.js test/contamination.test.js

echo "==> Collect generated evidence"
rm -rf "$OUT"
mkdir -p "$OUT"
docker run --rm --platform "$PLATFORM" \
  -v "$RESULTS_VOLUME":/from:ro -v "$OUT":/to \
  "$IMAGE" sh -c 'cp -a /from/. /to/'
docker run --rm --platform "$PLATFORM" \
  -v "$ARTIFACTS_VOLUME":/from:ro -v "$OUT":/to \
  "$IMAGE" sh -c "cp /from/manifest-reduced.json /to/phase-a-manifest.$ARCH_TAG.json"

node harness/compare_runs.js determinism "$OUT" "$ARCH_TAG" main det1 det2
node harness/make_reduced_report.js "$OUT"

# Keep the measured hashes, not duplicate row files from repeat processes.
rm -f "$OUT/results.det1.json" "$OUT/results.det2.json"
rm -f "$OUT"/predictions/*.det1.json "$OUT"/predictions/*.det2.json

echo "Reduced results: $OUT/leaderboard.md"
