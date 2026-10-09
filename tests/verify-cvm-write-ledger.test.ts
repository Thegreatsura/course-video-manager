import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The clone's Write Ledger verdict (`verify.sh guard check`), from the rows
 * its triggers recorded and the statements the server logged.
 *
 * It once split the sidecar's writes from the server's by TABLE — job,
 * job_event and sidecar_lease were "the sidecar's" — so when the server itself
 * wrote a Job Event (POST /api/jobs/dismiss) or enqueued a Job (Export), the
 * Ledger said "clean — no writes" and "none committed a row". It now splits
 * by the connection that wrote. This drives the real guard_check_clone with
 * the database reads stubbed, so it needs no Postgres.
 */
const SCRIPTS = join(
  import.meta.dirname,
  "..",
  ".claude/skills/verify-cvm/scripts"
);

const JOB_EVENT_INSERT =
  '[cvm-sql] insert into "course-video-manager_job_event" ("id", "job_id", "type", "data", "at") values (default, $1, $2, $3, default)';
const JOB_INSERT =
  '[cvm-sql] insert into "course-video-manager_job" ("id", "kind", "title") values ($1, $2, $3)';

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** Run guard_check_clone over these committed rows and server.log lines. */
const check = (opts: { rows: string[]; statements: string[] }) => {
  const dir = mkdtempSync(join(tmpdir(), "verify-ledger-"));
  dirs.push(dir);
  writeFileSync(join(dir, "guard-snapshot.txt"), "100:100:\n");
  writeFileSync(join(dir, "guard-sql-offset.txt"), "0\n");
  writeFileSync(
    join(dir, "server.log"),
    ["[cvm-sql] select 1", ...opts.statements].join("\n") + "\n"
  );
  writeFileSync(join(dir, "writes.txt"), opts.rows.join("\n"));
  const script = `
    set -euo pipefail
    log() { printf '%s\\n' "$*" >&2; }
    die() { log "FAIL: $*"; exit 1; }
    . "${SCRIPTS}/verify-ledger.sh"
    . "${SCRIPTS}/verify-guard.sh"
    ledger_in_flight() { echo 0; }
    ledger_uncovered() { :; }
    ledger_writes() { cat "$1/writes.txt"; }
    guard_check_clone "$1" "$1/WRITE-LEDGER.md"
  `;
  const result = spawnSync("bash", ["-c", script, "guard", dir], {
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return {
    log: result.stderr,
    ledger: readFileSync(join(dir, "WRITE-LEDGER.md"), "utf8"),
  };
};

describe("verify-cvm: the Write Ledger attributes job-table writes by connection", () => {
  it("never calls a run clean when the server committed a Job Event (Job dismissal)", () => {
    const { log, ledger } = check({
      rows: [
        "server|course-video-manager_job_event|6|0|0|0",
        "sidecar|course-video-manager_sidecar_lease|0|12|0|0",
      ],
      statements: Array(6).fill(JOB_EVENT_INSERT),
    });
    expect(log).not.toMatch(/clean/);
    expect(log).toMatch(
      /writes landed .* server: course-video-manager_job_event;/
    );
    expect(ledger).toMatch(
      /Writes committed by this run's server[\s\S]*\| course-video-manager_job_event \| 6 \| 0 \| 0 \| 0 \|/
    );
    expect(ledger).not.toMatch(/Nothing was modified/);
    expect(ledger).not.toMatch(/not committed/);
  });

  it("lists the server's enqueue apart from the sidecar's run of the same Job (Export)", () => {
    const { ledger } = check({
      rows: [
        "server|course-video-manager_job|1|0|0|0",
        "server|course-video-manager_job_event|2|0|0|0",
        "sidecar|course-video-manager_job|0|4|0|0",
        "sidecar|course-video-manager_job_event|47|0|0|0",
        "sidecar|course-video-manager_sidecar_lease|0|10|0|0",
      ],
      statements: [JOB_INSERT, JOB_EVENT_INSERT, JOB_EVENT_INSERT],
    });
    const [serverPart, sidecarPart] = ledger.split("Background, committed by");
    expect(serverPart).toContain(
      "| course-video-manager_job | 1 | 0 | 0 | 0 |"
    );
    expect(serverPart).toContain(
      "| course-video-manager_job_event | 2 | 0 | 0 | 0 |"
    );
    expect(sidecarPart).toContain(
      "| course-video-manager_job | 0 | 4 | 0 | 0 |"
    );
    expect(sidecarPart).toContain(
      "| course-video-manager_job_event | 47 | 0 | 0 | 0 |"
    );
    expect(ledger).not.toMatch(/not committed/);
  });

  it("names the table the server wrote to without committing, even beside a committed one", () => {
    const { ledger } = check({
      rows: ["server|course-video-manager_job|1|0|0|0"],
      statements: [JOB_INSERT, JOB_EVENT_INSERT],
    });
    expect(ledger).toMatch(
      /Sent but not committed[\s\S]*course-video-manager_job_event: 1 write statement\(s\), no row committed/
    );
    expect(ledger).not.toMatch(/course-video-manager_job: 1 write/);
  });

  it("does not call sidecar-only writes clean, and says the server wrote nothing", () => {
    const { log, ledger } = check({
      rows: ["sidecar|course-video-manager_sidecar_lease|0|3|0|0"],
      statements: [],
    });
    expect(log).not.toMatch(/clean/);
    expect(log).toMatch(/no write from this run's server/);
    expect(ledger).toContain(
      "This run's server committed no write; only the sidecar's background above."
    );
  });

  it("reports writes from any other connection (an agent's psql) as writes", () => {
    const { log, ledger } = check({
      rows: ["other:psql|course-video-manager_job|2|0|0|0"],
      statements: [],
    });
    expect(log).toMatch(
      /writes landed .* other connections: course-video-manager_job;/
    );
    expect(ledger).toContain(
      "| psql | course-video-manager_job | 2 | 0 | 0 | 0 |"
    );
  });

  it("calls a window with no committed row at all clean", () => {
    const { log, ledger } = check({ rows: [], statements: [] });
    expect(log).toMatch(/guard: clean — no writes/);
    expect(ledger).toContain("Nothing was modified.");
  });
});
