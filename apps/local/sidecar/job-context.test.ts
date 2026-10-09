import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const KINDS_DIR = path.join(import.meta.dirname, "kinds");

/**
 * A kind that starts another Job (a Batch export handing a Video on) does it
 * through `ctx.enqueue`, the one path every Job takes: the kind's own lane
 * and attempts, its params checked, and a dependency that already failed
 * failing it at once (#1902). A kind that writes the job table itself skips
 * all of that — the Batch export's hand-off once did.
 */
describe("a kind starts another Job only through ctx.enqueue", () => {
  const sources = fs
    .readdirSync(KINDS_DIR)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => ({
      file,
      text: fs.readFileSync(path.join(KINDS_DIR, file), "utf8"),
    }));

  it.each(sources)("$file never enqueues a Job itself", ({ text }) => {
    expect(text).not.toMatch(/\benqueueJob\s*\(/);
    expect(text).not.toMatch(/\.insert\(\s*jobs\s*\)/);
  });
});
