import { describe, expect, it } from "vitest";
import { judgeMigrationPr } from "../scripts/check-migration-pr";

const MIGRATION = "packages/core/db/migrations/0029_example.sql";
const JOURNAL = "packages/core/db/migrations/meta/_journal.json";
const SCHEMA = "packages/core/db/schema.ts";
const CODE = "packages/core/services/db-clip-operations.server.ts";

const problems = (files: string[], labels: string[] = []) => {
  const v = judgeMigrationPr({ files, labels });
  return v.ok ? [] : v.problems.map((p) => p.split(":")[0]);
};

describe("judgeMigrationPr", () => {
  it("passes a migration-only PR (migration files, migrations.test.ts, docs)", () => {
    expect(
      problems([
        MIGRATION,
        JOURNAL,
        "packages/core/db/migrations/meta/0029_snapshot.json",
        "packages/core/db/migrations.test.ts",
        "docs/adr/0099-example.md",
      ])
    ).toEqual([]);
  });

  it("passes a PR that touches neither migrations nor the schema", () => {
    expect(problems([CODE, "README.md"])).toEqual([]);
  });

  it("fails a migration shipped with code that uses it (PR #1859)", () => {
    expect(problems([MIGRATION, JOURNAL, CODE])).toEqual(["migration-only"]);
  });

  it("fails a migration shipped with its schema.ts mirror, even when labelled", () => {
    expect(problems([MIGRATION, SCHEMA], ["migration-applied"])).toEqual([
      "migration-only",
    ]);
  });

  it("fails a migration and its schema.ts mirror with both reasons when unlabelled", () => {
    expect(problems([MIGRATION, SCHEMA])).toEqual([
      "migration-only",
      "migration-applied",
    ]);
  });

  it("fails a changed (not only added) migration alongside code", () => {
    expect(
      problems([
        "packages/core/db/migrations/0027_video_format_repair.sql",
        CODE,
      ])
    ).toEqual(["migration-only"]);
  });

  it("fails a schema change without the migration-applied label", () => {
    expect(problems([SCHEMA, CODE], ["agent:review"])).toEqual([
      "migration-applied",
    ]);
    expect(problems(["packages/core/db/schema-auth.ts"])).toEqual([
      "migration-applied",
    ]);
  });

  it("passes the follow-up PR once Matt has added migration-applied", () => {
    expect(problems([SCHEMA, CODE], ["migration-applied"])).toEqual([]);
  });

  it("does not treat schema-feature-probes.ts as the schema", () => {
    expect(problems(["packages/core/db/schema-feature-probes.ts"])).toEqual([]);
  });
});
