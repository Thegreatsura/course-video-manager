// `tsc` must be the build `effect-tsgo patch` installs.
//
// The Effect rules in each package's `tsconfig.json` run inside `typecheck`
// only because the root `prepare` script (`scripts/patch-tsc.sh`) patches the
// native `tsc`. If the patch is skipped — `pnpm install --ignore-scripts`, a
// restored node_modules, a `typescript` bump with no matching `@effect/tsgo`
// build — `tsc` still exits 0 and the Effect rules silently stop gating.
//
// This guard runs core's `tsc` on `packages/core/.effect-tsc-canary`, a file
// with one deliberate `floatingEffect`, and fails unless `tsc` reports it. It
// also fails if a package resolves a different `typescript` from core's, since
// the canary would then not speak for that package's `typecheck`.
//
// See docs/plans/effect-codebase-health.md (Phase 4).

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const PACKAGES = ["packages/core", "apps/local", "apps/remote"];
const CANARY = "packages/core/.effect-tsc-canary/tsconfig.json";
const EXPECTED = "effect(floatingEffect)";

const fail = (message: string): never => {
  console.error(`check-effect-tsc: ${message}`);
  console.error("Fix: run `pnpm install` (its `prepare` script patches tsc).");
  process.exit(1);
};

const typescriptDirs = new Set(
  PACKAGES.map((pkg) =>
    realpathSync(path.join(root, pkg, "node_modules/typescript"))
  )
);
if (typescriptDirs.size !== 1) {
  fail(
    `${PACKAGES.join(", ")} resolve different typescript installs:\n  ${[...typescriptDirs].join("\n  ")}`
  );
}

const tsc = path.join(root, "packages/core/node_modules/.bin/tsc");
const result = spawnSync(
  tsc,
  ["-p", path.join(root, CANARY), "--pretty", "false"],
  { encoding: "utf8" }
);
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.status === 0 || !output.includes(EXPECTED)) {
  fail(
    `tsc did not report the canary's ${EXPECTED}, so it is not the Effect-patched build.\n${output}`
  );
}

console.log("check-effect-tsc: tsc reports Effect diagnostics.");
