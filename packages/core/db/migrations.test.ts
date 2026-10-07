import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { pushSchema } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";
import * as schema from "./schema.js";

const MIGRATIONS_FOLDER = join(import.meta.dirname, "migrations");

/**
 * Each of these boots a fresh PGlite and replays every migration, which is the
 * slowest thing in the suite by an order of magnitude. Vitest's 5s default left
 * no headroom on a loaded machine, so the budget is stated rather than relied on.
 */
const MIGRATION_TIMEOUT_MS = 60_000;

describe("drizzle migrations", () => {
  it(
    "baseline SQL hash matches what readMigrationFiles would compute",
    async () => {
      const journal = JSON.parse(
        readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf-8")
      );
      const baseline = journal.entries[0];
      const sqlContent = readFileSync(
        join(MIGRATIONS_FOLDER, `${baseline.tag}.sql`),
        "utf-8"
      );
      const expectedHash = createHash("sha256")
        .update(sqlContent)
        .digest("hex");

      const pglite = new PGlite();
      const db = drizzle(pglite, { schema });
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await db.execute<{ hash: string; created_at: string }>(
        sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations`
      );

      expect(rows.rows[0]!.hash).toBe(expectedHash);
      expect(Number(rows.rows[0]!.created_at)).toBe(baseline.when);

      await pglite.close();
    },
    MIGRATION_TIMEOUT_MS
  );

  it(
    "migrate produces the same public-schema tables as pushSchema",
    async () => {
      const getPublicTables = async (db: ReturnType<typeof drizzle>) => {
        const result = await db.execute<{ tablename: string }>(
          sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
        );
        return result.rows.map((r) => r.tablename);
      };

      const migratePg = new PGlite();
      const migrateDb = drizzle(migratePg, { schema });
      await migrate(migrateDb, { migrationsFolder: MIGRATIONS_FOLDER });
      const migrateTables = await getPublicTables(migrateDb);

      const pushPg = new PGlite();
      const pushDb = drizzle(pushPg, { schema });
      const { apply } = await pushSchema(schema, pushDb as any);
      await apply();
      const pushTables = await getPublicTables(pushDb);

      expect(migrateTables).toEqual(pushTables);

      await migratePg.close();
      await pushPg.close();
    },
    MIGRATION_TIMEOUT_MS
  );

  /**
   * drizzle's migrator applies only the migrations whose `when` is newer than
   * the newest one already recorded, so a migration that lands with an older
   * `when` than one a database has already run is skipped there forever,
   * silently. That is how 0004_video_format_landscape never reached
   * production (see 0027_video_format_repair). Regenerate the migration on
   * top of main rather than keeping a stale `when` through a rebase.
   */
  it("every migration's `when` is later than the one before it", () => {
    const journal: { entries: { tag: string; when: number }[] } = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf-8")
    );
    // 0007 and 0008 were applied in the same `migrate` run, which reads the
    // newest recorded `when` once up front, so the inversion was harmless.
    const knownInversions = new Set(["0008_add_video_script"]);

    const outOfOrder = journal.entries
      .filter((entry, i) => i > 0 && entry.when <= journal.entries[i - 1]!.when)
      .map((entry) => entry.tag)
      .filter((tag) => !knownInversions.has(tag));

    expect(outOfOrder).toEqual([]);
  });

  it(
    "0028 backfills each Clip's Transcription status from what it already had",
    async () => {
      // Migrate to just before 0028 from a copy of the folder whose journal
      // stops at 0027, seed the Clips, then run the real folder for 0028.
      const before = mkdtempSync(join(tmpdir(), "cvm-migrations-"));
      cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
      const journalPath = join(before, "meta/_journal.json");
      const journal: { entries: { tag: string }[] } = JSON.parse(
        readFileSync(journalPath, "utf-8")
      );
      const cut = journal.entries.findIndex(
        (entry) => entry.tag === "0028_clip_transcription_status"
      );
      writeFileSync(
        journalPath,
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) })
      );

      const pglite = new PGlite();
      const db = drizzle(pglite, { schema });
      await migrate(db, { migrationsFolder: before });
      rmSync(before, { recursive: true, force: true });

      // Clip rows only: the Video they point at is beside the point here.
      await db.execute(sql`SET session_replication_role = replica`);
      await db.execute(sql`
        INSERT INTO "course-video-manager_clip"
          (id, video_id, video_filename, source_start_time, source_end_time, "order", text, transcribed_at)
        VALUES
          ('transcribed', 'v', 'f.mp4', 0, 1, 'a', 'hello', now()),
          ('heard-nothing', 'v', 'f.mp4', 0, 1, 'b', '', now()),
          ('text-no-timestamp', 'v', 'f.mp4', 0, 1, 'c', 'from footage', NULL),
          ('never-transcribed', 'v', 'f.mp4', 0, 1, 'd', '', NULL)
      `);
      await db.execute(sql`SET session_replication_role = DEFAULT`);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await db.execute<{ id: string; status: string }>(
        sql`SELECT id, transcription_status AS status FROM "course-video-manager_clip" ORDER BY "order"`
      );
      expect(rows.rows).toEqual([
        { id: "transcribed", status: "done" },
        { id: "heard-nothing", status: "done" },
        { id: "text-no-timestamp", status: "done" },
        { id: "never-transcribed", status: "failed" },
      ]);

      await pglite.close();
    },
    MIGRATION_TIMEOUT_MS
  );
});
