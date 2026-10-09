import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const SCRIPT = path.join(import.meta.dirname, "keep-running.sh");

/** A command that crashes `crashes` times, then exits 0; counts its runs. */
const flaky = (crashes: number) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keep-running-"));
  const count = path.join(dir, "runs");
  const command = `n=$(( $(cat ${count} 2>/dev/null || echo 0) + 1 )); echo $n > ${count}; [ $n -gt ${crashes} ]`;
  return {
    args: ["bash", "-c", command],
    runs: () => Number(fs.readFileSync(count, "utf8")),
  };
};

describe("keep-running.sh", () => {
  it("starts a command that crashed again, until it exits on purpose", async () => {
    const command = flaky(2);
    const { stdout } = await run(SCRIPT, command.args, {
      env: { ...process.env, KEEP_RUNNING_FIRST_DELAY: "0" },
    });
    expect(command.runs()).toBe(3);
    expect(stdout.match(/CRASHED \(exit 1\)/g)).toHaveLength(2);
  });

  it("does not start a command again that exited 0", async () => {
    const command = flaky(0);
    await run(SCRIPT, command.args);
    expect(command.runs()).toBe(1);
  });
});
