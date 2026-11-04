#!/usr/bin/env bash
# Run the visual-regression suite inside the Playwright Docker image, so the
# pixels match CI (the `web-visual` job uses the same image).
#
#   bash e2e/run-in-docker.sh                     # compare against snapshots
#   bash e2e/run-in-docker.sh --update-snapshots  # regenerate snapshots
#
# Any other argument is passed to `playwright test` unchanged.
#
# - apps/web is bind-mounted at /work; snapshots land in e2e/__screenshots__.
# - node_modules and .next live in named volumes, so the host's macOS
#   binaries and build output are never touched by the Linux container.
# - `npm ci` runs only when package-lock.json changed since the last run
#   (its hash is stored inside the node_modules volume).
# - The image is pinned to linux/amd64 because CI runs on amd64: Chromium's
#   raster output can differ between architectures. On Apple Silicon this runs
#   under emulation and is slower, but the snapshots match CI.
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble"
PLATFORM="${E2E_DOCKER_PLATFORM:-linux/amd64}"
WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

args=()
for arg in "$@"; do
  if [[ "$arg" == "--update-snapshots" ]]; then
    # "all" rewrites every snapshot, not only the missing or failing ones.
    args+=("--update-snapshots=all")
  else
    args+=("$arg")
  fi
done

tty_flags=()
if [[ -t 1 ]]; then tty_flags+=("-t"); fi

exec docker run --rm "${tty_flags[@]}" \
  --platform "$PLATFORM" \
  --ipc=host \
  -e CI="${CI:-}" \
  -e HOME=/tmp/e2e-home \
  -v "$WEB_DIR":/work \
  -v icaro-web-e2e-node_modules:/work/node_modules \
  -v icaro-web-e2e-next:/work/.next \
  -w /work \
  "$IMAGE" \
  bash -euo pipefail -c '
    lock_hash="$(sha256sum package-lock.json | cut -d" " -f1)"
    stamp=node_modules/.e2e-lock-hash
    if [[ ! -f "$stamp" || "$(cat "$stamp")" != "$lock_hash" ]]; then
      echo "[e2e] package-lock.json changed: npm ci"
      npm ci --no-audit --no-fund
      echo "$lock_hash" > "$stamp"
    fi
    exec npx playwright test "$@"
  ' run-in-docker "${args[@]+"${args[@]}"}"
