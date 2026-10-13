/**
 * One-off: move what CVM wrote before it had a Storage Root (#2105) onto the
 * first root, and rewrite the rows that name it. Matt runs it, from main
 * (#2106).
 *
 *   pnpm storage:relocate            # dry run: plan only, changes nothing
 *   pnpm storage:relocate --apply    # copy + verify, rename, rewrite, clean up
 *
 * - CVM-recorder Recording Sessions (and AV Calibration runs) in ~/Videos
 *   move to raw-footage/ (raw-footage/av-calibrations/) on the first root.
 * - Video Files in this checkout's video-files/ folders move to video-files/.
 * - Thumbnail rows are rewritten root-relative; a path into an old
 *   .worktrees checkout is repaired, or reported if the file is gone.
 * - Each Exported Video whose Export Hash the moved sessions change is
 *   renamed, not re-encoded. Run `pnpm storage:rename-exports --apply` first.
 *
 * --apply refuses while this checkout's app (port 5173) or Sidecar is
 * running: stop `pnpm dev` first, and record nothing while it runs. It copies
 * and checks every file (size and SHA-256) before any row changes; any
 * failure removes the copies and changes nothing. The originals are removed
 * only after the rows are committed. Safe to run again.
 */
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { readStorageRootsSync } from "@/services/storage-roots";
import { legacyVideoFilesStores } from "@/services/video-files";
import {
  applyRelocation,
  planRelocation,
} from "@/services/storage-relocation.server";
import { scriptDrizzle } from "./script-database-url";
import { CVM_APP_PORT, refuseApplyWhileCvmRuns } from "./running-cvm";
import { sidecarSocketPath } from "@/services/sidecar-socket.server";

const apply = process.argv.includes("--apply");
const roots = readStorageRootsSync();
const legacy = legacyVideoFilesStores();
console.log(`Storage Roots: ${roots.join(", ")} (writing to ${roots[0]})`);
console.log(`Legacy Video Files stores: ${legacy.join(", ") || "none"}`);
console.log(apply ? "Mode: APPLY" : "Mode: dry run (pass --apply to move)");

if (apply) {
  await refuseApplyWhileCvmRuns({
    appPort: CVM_APP_PORT,
    sidecarSocket: sidecarSocketPath(),
  });
}

const { db } = scriptDrizzle();

const program = Effect.gen(function* () {
  const plan = yield* planRelocation(db as Database, {
    roots,
    legacyVideoFilesStores: legacy,
  });
  const list = (title: string, items: readonly string[]) => {
    console.log(`\n${title}: ${items.length}`);
    for (const item of items) console.log(`  ${item}`);
  };
  list(
    "Files to copy",
    plan.copies.map((c) => `${c.from}\n    -> ${c.to}`)
  );
  list(
    "Rows to rewrite",
    plan.rows.map((r) => `${r.row}: ${r.from}\n    -> ${r.to}`)
  );
  list(
    "Exported Videos to rename",
    plan.exportRenames.map((r) => `${r.from}\n    -> ${r.to}`)
  );
  list("Originals removed after the rows are rewritten", plan.originals);
  list("Named by a row but found nowhere (left as they are)", plan.missing);
  list("Legacy Video Files left in place (shadowed)", plan.shadowed);

  if (plan.problems.length > 0) {
    console.error(
      `\nABORTED: ${plan.problems.length} problem(s). Nothing was changed.`
    );
    for (const p of plan.problems) console.error(`  ${p}`);
    return 1;
  }
  if (!apply) {
    console.log("\nDry run: nothing changed. Re-run with --apply to move.");
    return 0;
  }
  const result = yield* applyRelocation(db as Database, plan, roots);
  console.log(
    `\nCopied ${result.copied} file(s), rewrote ${result.rows} path(s), renamed ${result.exportsRenamed} export file(s).`
  );
  console.log(
    `Removed ${result.originalsRemoved} original(s); ${result.originalsLeft} could not be removed (open on Windows?) — remove them by hand, or re-run.`
  );
  return 0;
});

const code = await Effect.runPromise(
  program.pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`\nFAILED: ${error.message}`);
        return 1;
      })
    ),
    Effect.provide(NodeContext.layer)
  )
);
process.exit(code);
