#!/usr/bin/env bash
# Runs from the root `prepare` script, after every `pnpm install`.
#
# Swaps the native `tsc` that `typescript` ships for the build in `@effect/tsgo`,
# so `pnpm run typecheck` (and an editor using the workspace `tsc`) reports the
# Effect diagnostics configured in each package's `tsconfig.json`. The patch
# renames the original binary to `tsc.original` and copies the new one in, so
# the shared pnpm store is never written to. It is idempotent.
#
# Skipped on Vercel: `apps/remote` deploys compile with the project's `tsc`,
# and that build has no use for Effect diagnostics.
#
# `scripts/check-effect-tsc.ts` fails `check` if `tsc` is not patched.
set -euo pipefail

if [[ -n "${VERCEL:-}" ]]; then
  exit 0
fi

pnpm exec effect-tsgo patch --typescript --log-level warn
