#!/usr/bin/env bash
# Copy a completed bench run out of its Docker volumes into
# tools/classifier-bench/results/, then regenerate every derived artifact from
# code. Nothing in results/ is ever hand-written.
#
#   ./scripts/collect_results.sh [resultsVolume] [artifactsVolumeArchA] [artifactsVolumeArchB]
#
# Defaults match the #137 v2 run:
#   bench-results-v2  bench-artifacts-v2 (arm64)  bench-artifacts-amd64-v2 (x64)
#
# Model binaries and the compiled UT1 table are NEVER copied into the repo —
# only their Phase A manifests, which carry the SHA-256 of every fetched file.
set -euo pipefail

# Helper image pinned by digest for the same reason the bench image is: a floating
# tag means the copy step is not reproducible. Only used to copy bytes out of
# Docker volumes and chown them.
ALPINE="alpine:3@sha256:79ff19e9084a00eece421b2523fb93e22d730e2c0e525905de047e848e56d95f"

RESULTS_VOLUME="${1:-bench-results-v2}"
ARTIFACTS_VOLUME_A="${2:-bench-artifacts-v2}"
ARTIFACTS_VOLUME_B="${3:-bench-artifacts-amd64-v2}"
ARCH_A="${ARCH_A:-arm64}"
ARCH_B="${ARCH_B:-x64}"
# Recorded verbatim into cross-arch-comparison.json so the emulation caveat
# travels with the numbers instead of living only in prose.
EMULATION_NOTE="${EMULATION_NOTE:-linux/amd64 ran under Docker binary emulation on an arm64 host, not on native amd64 hardware}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH="$(cd "$HERE/.." && pwd)"
DEST="$BENCH/results"
OWNER="$(id -u):$(id -g)"

mkdir -p "$DEST"

echo "==> copying run outputs from volume $RESULTS_VOLUME"
docker run --rm -v "$RESULTS_VOLUME":/r -v "$DEST":/out "$ALPINE" \
  sh -c "cp -R /r/. /out/ && chown -R $OWNER /out"

echo "==> copying Phase A manifests (digests only, never the artifacts)"
docker run --rm -v "$ARTIFACTS_VOLUME_A":/a -v "$DEST":/out "$ALPINE" \
  sh -c "cp /a/manifest.json /out/phase-a-manifest.$ARCH_A.json && chown $OWNER /out/phase-a-manifest.$ARCH_A.json"
if docker volume inspect "$ARTIFACTS_VOLUME_B" >/dev/null 2>&1; then
  docker run --rm -v "$ARTIFACTS_VOLUME_B":/a -v "$DEST":/out "$ALPINE" \
    sh -c "cp /a/manifest.json /out/phase-a-manifest.$ARCH_B.json && chown $OWNER /out/phase-a-manifest.$ARCH_B.json"
else
  echo "    (no $ARTIFACTS_VOLUME_B volume; $ARCH_B parity will not be generated)"
fi

cd "$BENCH"

echo "==> separate-process determinism ($ARCH_A: main, det1, det2)"
node harness/compare_runs.js determinism results "$ARCH_A" main det1 det2

if [ -f "results/phase-a-manifest.$ARCH_B.json" ]; then
  echo "==> cross-architecture decision comparison ($ARCH_A vs $ARCH_B)"
  node harness/compare_runs.js cross-arch results "$ARCH_A" "$ARCH_B" main "$EMULATION_NOTE"

  echo "==> Phase A artifact parity ($ARCH_A vs $ARCH_B)"
  node harness/compare_runs.js artifacts results \
    "results/phase-a-manifest.$ARCH_A.json" "results/phase-a-manifest.$ARCH_B.json" "$ARCH_A" "$ARCH_B"
fi

echo "==> leaderboard"
node harness/make_leaderboard.js

echo
echo "results/ now contains:"
ls -1 "$DEST"
