/**
 * Restore the child rows Submit's version copy dropped on every new Draft:
 * Learning Goals (with their Beat links), Clip Web Links and Transcript Words
 * (see packages/core/services/version-children-repair.ts for the rules).
 *
 * DRY RUN BY DEFAULT — prints what it would add and writes nothing.
 * Pass `--apply` to write, in one transaction.
 *
 *   pnpm --filter @cvm/local db:repair-version-children            # dry run
 *   pnpm --filter @cvm/local db:repair-version-children --apply    # write
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@cvm/core/db/schema";
import { resolveDatabaseUrl } from "@cvm/core/db/database-url";
import { courseNames } from "@cvm/core/services/clip-carry-repair.server";
import { runVersionChildrenRepair } from "@cvm/core/services/version-children-repair.server";

const apply = process.argv.includes("--apply");
const url = resolveDatabaseUrl();
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const host = new URL(url).host;

const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });

const plan = await runVersionChildrenRepair(db as any, { apply });

const courseIds = [
  ...new Set(
    [
      ...plan.goals,
      ...plan.webLinks,
      ...plan.words,
      ...plan.unmatchedBeatLinks,
      ...plan.archivedInDraft,
    ].map((row) => row.courseId)
  ),
];
const names = await courseNames(db as any, courseIds);
const inCourse = <T extends { courseId: string }>(rows: T[], id: string) =>
  rows.filter((row) => row.courseId === id);
const distinct = (values: string[]) => new Set(values).size;

console.log(`${apply ? "APPLY" : "DRY RUN"} against ${host}`);
for (const id of courseIds) {
  const goals = inCourse(plan.goals, id);
  const webLinks = inCourse(plan.webLinks, id);
  const words = inCourse(plan.words, id);
  console.log(`  ${names.get(id) ?? id}:`);
  console.log(
    `    ${goals.length} Learning Goal(s) restored into ${distinct(goals.map((g) => g.sectionId))} Section(s), ${inCourse(plan.beatLinks, id).length} Beat link(s)`
  );
  console.log(
    `    ${webLinks.length} Clip Web Link(s) onto ${distinct(webLinks.map((l) => l.clipId))} Clip(s); ${words.length} Transcript Word(s) onto ${distinct(words.map((w) => w.clipId))} Clip(s)`
  );
  for (const skip of inCourse(plan.archivedInDraft, id)) {
    console.log(
      `    AMBIGUOUS: "${skip.goalTitle}" is archived in the Draft (Section ${skip.sectionId}) — not restored`
    );
  }
  const unmatched = inCourse(plan.unmatchedBeatLinks, id);
  if (unmatched.length > 0) {
    console.log(
      `    ${unmatched.length} Beat link(s) skipped — no single Draft Beat with the same kind and title in that Video or Section:`
    );
    for (const u of unmatched) {
      console.log(`      "${u.beatTitle}" -> "${u.goalTitle}"`);
    }
  }
}
console.log(
  `Total: ${plan.goals.length} goal(s), ${plan.beatLinks.length} beat link(s), ${plan.webLinks.length} web link(s), ${plan.words.length} word(s) across ${plan.versionIds.length} Draft(s).`
);
console.log(
  apply ? "Applied." : "Nothing written. Re-run with --apply to write."
);
await pool.end();
