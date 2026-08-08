#!/usr/bin/env bash
# One command to reproduce the whole ChmaraX/forensix#137 bench run on the
# HOST architecture, then collect and regenerate every artifact in results/.
#
#   ./scripts/reproduce.sh
#
# Phases (the two-phase split is the point: nothing is fetched while measuring):
#   0. build the pinned image
#   1. Phase A, network ON  — fetch + SHA-256 every model artifact, compile UT1
#   2. Phase B, --network none, run three times in three separate processes
#      (main, det1, det2) — that is the determinism check; an in-process repeat
#      cannot detect fresh-process nondeterminism
#   3. unit tests inside the image
#   4. collect + regenerate results/ (see scripts/collect_results.sh)
#
# Wall clock on a native arm64 host: Phase A ~4 min (417 MB of artifacts),
# each Phase B run ~5 min, dominated by the NLI cross-encoder (~4 min alone).
#
# Cross-architecture: re-run this with PLATFORM=linux/amd64 ARCH_TAG=amd64
# ARTIFACTS_VOLUME=bench-artifacts-amd64-v2. Under binary emulation on an arm64
# host the NLI candidate did not finish inside a two-hour bound; see
# research/137-harness.md.
set -euo pipefail

PLATFORM="${PLATFORM:-linux/arm64}"
ARCH_TAG="${ARCH_TAG:-arm64}"
IMAGE="${IMAGE:-classifier-bench:$ARCH_TAG}"
ARTIFACTS_VOLUME="${ARTIFACTS_VOLUME:-bench-artifacts-v2}"
RESULTS_VOLUME="${RESULTS_VOLUME:-bench-results-v2}"
RUN_TAGS="${RUN_TAGS:-main det1 det2}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH="$(cd "$HERE/.." && pwd)"
cd "$BENCH"

echo "==> 0. build $IMAGE for $PLATFORM"
docker build --platform "$PLATFORM" -f harness/Dockerfile -t "$IMAGE" .
# Recorded into results.json so a run is bound to the image that produced it.
IMAGE_DIGEST="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
echo "    image id: $IMAGE_DIGEST"

docker volume create "$ARTIFACTS_VOLUME" >/dev/null
docker volume create "$RESULTS_VOLUME" >/dev/null

echo "==> 1. Phase A (network ON): fetch and verify artifacts"
docker run --rm --platform "$PLATFORM" \
  -v "$ARTIFACTS_VOLUME":/artifacts \
  -e ARTIFACTS_DIR=/artifacts \
  "$IMAGE" node download.js

for tag in $RUN_TAGS; do
  echo "==> 2. Phase B run '$tag' (--network none, separate process)"
  docker run --rm --platform "$PLATFORM" --network none \
    -v "$ARTIFACTS_VOLUME":/artifacts:ro -v "$RESULTS_VOLUME":/results \
    -e ARTIFACTS_DIR=/artifacts -e RESULTS_DIR=/results -e RUN_TAG="$tag" \
    -e IMAGE_DIGEST="$IMAGE_DIGEST" \
    "$IMAGE" node run_bench.js
done

# The results volume MUST be mounted here. Without it the artifact-integrity
# tests resolve RESULTS_DIR to a path that does not exist and silently skip --
# which is exactly the class of defect (a guard that is a no-op) this harness
# exists to catch. test/artifacts.test.js additionally throws when RESULTS_DIR is
# set but absent, so a mis-wired mount fails instead of passing green.
echo "==> 3. unit tests inside the image, against the run that just completed"
docker run --rm --platform "$PLATFORM" --network none \
  -v "$RESULTS_VOLUME":/results:ro -e RESULTS_DIR=/results \
  "$IMAGE" npm test

echo "==> 4. collect and regenerate results/"
"$HERE/collect_results.sh" "$RESULTS_VOLUME" "$ARTIFACTS_VOLUME"
