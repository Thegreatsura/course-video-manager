/**
 * Restore the Clip zoom and diagram pins that Submit's version copy dropped
 * on every new Draft (see packages/core/services/clip-carry-repair.server.ts).
 *
 * DRY RUN BY DEFAULT — prints what it would change and writes nothing.
 * Pass `--apply` to write, in one transaction.
 *
 *   pnpm --filter @cvm/local db:repair-clip-carry            # dry run
 *   pnpm --filter @cvm/local db:repair-clip-carry --apply    # write
 *
 * Reads the repo-root .env (see ./script-database-url.ts); set DATABASE_URL
 * in the environment to point it elsewhere.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@cvm/core/db/schema";
import {
  applyClipCarryRepair,
  courseNames,
  loadClipCarryRows,
  planClipCarryRepair,
} from "@cvm/core/services/clip-carry-repair.server";
import { scriptDatabaseUrl } from "./script-database-url";

const apply = process.argv.includes("--apply");
const { url, host } = scriptDatabaseUrl();

const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });

const fixes = planClipCarryRepair(await loadClipCarryRows(db as any));
const names = await courseNames(db as any, [
  ...new Set(fixes.map((f) => f.courseId)),
]);

console.log(`${apply ? "APPLY" : "DRY RUN"} against ${host}`);
const byCourse = Map.groupBy(fixes, (f) => f.courseId);
for (const [courseId, list] of byCourse) {
  const zoom = list.filter((f) => f.zoomType).length;
  const pin = list.filter((f) => f.diagramSnapshotId).length;
  console.log(
    `  ${names.get(courseId) ?? courseId}: ${list.length} Draft clip(s) — ${zoom} zoom restored, ${pin} diagram pin restored`
  );
}
console.log(`Total: ${fixes.length} Draft clip(s).`);

if (apply) {
  await applyClipCarryRepair(db as any, fixes);
  console.log("Applied.");
} else {
  console.log("Nothing written. Re-run with --apply to write.");
}
await pool.end();
