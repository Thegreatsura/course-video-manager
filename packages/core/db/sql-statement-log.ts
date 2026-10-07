import type { Logger } from "drizzle-orm";

/**
 * The app's own record of every statement it sends to Postgres, switched on
 * by `CVM_LOG_SQL=1`. The verify-cvm skill sets it for every verification run
 * and reads the lines back out of the server log to build its Write Ledger:
 * Postgres's cumulative stats lag (backends flush them only every so often),
 * so they cannot prove a window wrote nothing, and on a production run the
 * skill must not write anything to production to find out. This log is
 * immediate and needs nothing from the database.
 *
 * One line per statement on stdout, whitespace collapsed so a statement never
 * spans lines. Parameters are left out: the verb and the table are what the
 * Ledger needs, and parameters can carry whole transcripts.
 */
export const SQL_LOG_PREFIX = "[cvm-sql]";

export interface SqlLogEnv {
  readonly CVM_LOG_SQL?: string | undefined;
}

export const formatSqlLogLine = (query: string): string =>
  `${SQL_LOG_PREFIX} ${query.replace(/\s+/g, " ").trim()}`;

/** A Drizzle logger when `CVM_LOG_SQL` is set, otherwise none. */
export const sqlStatementLogger = (
  env: SqlLogEnv = process.env,
  write: (line: string) => void = (line) => console.log(line)
): Logger | undefined =>
  env.CVM_LOG_SQL
    ? { logQuery: (query: string) => write(formatSqlLogLine(query)) }
    : undefined;
