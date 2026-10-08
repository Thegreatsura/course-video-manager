import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `verify.sh launch` migrates a run's clone up to the checkout's schema. The
 * script that does it must refuse every target but this run's own clone on the
 * local verify Postgres — never the template, never another host. Each case
 * here is refused before a connection is attempted, so it needs no database.
 */
const SCRIPT = join(
  import.meta.dirname,
  "..",
  ".claude/skills/verify-cvm/scripts/migrate-clone.mjs"
);

const CLONE = "cvm_verify_20261008_120000_4242";

const migrate = (url: string, name = CLONE) =>
  spawnSync("node", [SCRIPT, url, name], { encoding: "utf8", timeout: 10_000 });

describe("verify-cvm: migrate-clone only ever touches this run's clone", () => {
  it.each([
    [
      "a remote host",
      `postgresql://u:secret@aws.connect.psdb.cloud:5433/${CLONE}`,
      "only the local verify Postgres",
    ],
    [
      "localhost on another port",
      `postgresql://u:secret@localhost:5432/${CLONE}`,
      "only the local verify Postgres",
    ],
    [
      "the template",
      "postgresql://u:secret@localhost:5433/cvm_verify_template",
      "not a per-run clone",
    ],
    [
      "another run's clone",
      "postgresql://u:secret@localhost:5433/cvm_verify_20261008_999999_1",
      "this run's clone is",
    ],
    ["a non-URL", "not a url", "not a URL"],
  ])("refuses %s, without printing the password", (_label, url, why) => {
    const result = migrate(url);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(why);
    expect(result.stderr).not.toContain("secret");
  });
});
