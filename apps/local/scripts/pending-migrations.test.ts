import { describe, expect, it } from "vitest";
import { pendingMigrations } from "./pending-migrations";

const journal = [
  { tag: "0000_a", when: 100 },
  { tag: "0001_b", when: 200 },
  { tag: "0002_c", when: 300 },
];

describe("pendingMigrations", () => {
  it("is empty when the database has applied the latest migration", () => {
    expect(pendingMigrations(journal, 300)).toEqual([]);
  });

  it("lists every migration newer than the newest one applied", () => {
    expect(pendingMigrations(journal, 100)).toEqual(["0001_b", "0002_c"]);
  });

  it("lists them all on a database that has never migrated", () => {
    expect(pendingMigrations(journal, 0)).toEqual([
      "0000_a",
      "0001_b",
      "0002_c",
    ]);
  });
});
