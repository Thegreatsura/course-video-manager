import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `verify.sh cvm` runs a worktree's real `cvm` against one run's test clone.
 * Before it starts anything it asserts the API it will hand `cvm` is loopback
 * and the database is the run's own clone — these are the shell halves of that
 * (the in-process half is apps/local/app/cli/verify-clone.test.ts). Sourced
 * directly, so they need no run, no database and no `.env`.
 */
const SCRIPTS = join(
  import.meta.dirname,
  "..",
  ".claude/skills/verify-cvm/scripts"
);

const sh = (body: string) =>
  spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
       log() { printf '%s\\n' "$*" >&2; }
       die() { log "FAIL: $*"; exit 1; }
       . "${SCRIPTS}/verify-db.sh"
       . "${SCRIPTS}/verify-cvm-cli.sh"
       ${body}`,
    ],
    { encoding: "utf8" }
  );

const CLONE = "cvm_verify_20261009_130519_2435964";

describe("verify.sh cvm — the loopback assertion", () => {
  it.each([
    "http://127.0.0.1:40319",
    "http://127.0.0.1:40319/",
    "http://localhost:5200",
    "http://[::1]:5300/rpc",
  ])("accepts %s", (url) => {
    expect(sh(`assert_loopback_url api "${url}"`).status).toBe(0);
  });

  it.each([
    "https://cvm-remote.vercel.app",
    "http://cvm-remote.vercel.app",
    "https://127.0.0.1:40319",
    "http://192.168.1.20:3000",
    "http://0.0.0.0:3000",
    "http://127.0.0.1.evil.com",
    "http://127.0.0.1@evil.com",
    "",
  ])("refuses %s", (url) => {
    const r = sh(`assert_loopback_url api "${url}"`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing: api is .* not loopback http/);
  });
});

describe("verify.sh cvm — the clone assertion", () => {
  it("accepts the run's own clone on the local Postgres", () => {
    expect(
      sh(
        `assert_clone_db_url ${CLONE} "postgresql://postgres:pw@localhost:5433/${CLONE}"`
      ).status
    ).toBe(0);
  });

  it.each([
    ["production", `postgresql://u:p@aws.connect.psdb.cloud/${CLONE}`],
    [
      "another clone",
      "postgresql://postgres:pw@localhost:5433/cvm_verify_20261009_000000_1",
    ],
    [
      "the template",
      "postgresql://postgres:pw@localhost:5433/cvm_verify_template",
    ],
  ])("refuses %s", (_, url) => {
    const r = sh(`assert_clone_db_url ${CLONE} "${url}"`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing/);
  });
});
