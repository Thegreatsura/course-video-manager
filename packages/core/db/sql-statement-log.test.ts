import { describe, expect, it } from "vitest";
import { sqlStatementLogger } from "./sql-statement-log.js";

describe("sqlStatementLogger", () => {
  it("logs nothing unless CVM_LOG_SQL is set", () => {
    expect(sqlStatementLogger({})).toBeUndefined();
  });

  it("writes one prefixed line per statement, never its parameters", () => {
    const lines: string[] = [];
    const logger = sqlStatementLogger({ CVM_LOG_SQL: "1" }, (line) =>
      lines.push(line)
    );
    logger?.logQuery(
      'update "course-video-manager_video"\n  set "title" = $1\n where "id" = $2',
      ["a secret title", "v1"]
    );
    expect(lines).toEqual([
      '[cvm-sql] update "course-video-manager_video" set "title" = $1 where "id" = $2',
    ]);
  });
});
