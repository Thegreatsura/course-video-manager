import { AsyncLocalStorage } from "node:async_hooks";

/**
 * How many SQL statements one server request sent — the number that tells a
 * 5-row loop from a 500-row loop, which no static guard can. The slow-request
 * log in `apps/local` opens a tally per request and prints it beside the
 * request's duration; `DrizzleService`'s logger counts into whichever tally is
 * current when a statement is sent.
 *
 * The tally rides on `AsyncLocalStorage`, so it follows `await`s inside a
 * query's async function. Effect's scheduler runs fibers from a shared queue,
 * which loses that context, so the Effect side must also run each scheduled
 * task through `run` (see `tallyStatements` in `apps/local`).
 */
export interface SqlStatementTally {
  readonly count: number;
  /** Runs `fn` with this tally current. */
  run<T>(fn: () => T): T;
}

const current = new AsyncLocalStorage<{ count: number }>();

export const startSqlStatementTally = (): SqlStatementTally => {
  const store = { count: 0 };
  return {
    get count() {
      return store.count;
    },
    run: (fn) => current.run(store, fn),
  };
};

/**
 * The tally the current request opened, if any: what a route's Effect
 * carries across the scheduler (see `tallyStatements` in `apps/local`).
 */
export const currentSqlStatementTally = (): SqlStatementTally | undefined => {
  const store = current.getStore();
  if (!store) return undefined;
  return {
    get count() {
      return store.count;
    },
    run: (fn) => current.run(store, fn),
  };
};

/** Counts one statement into the current tally; a no-op outside one. */
export const countSqlStatement = (): void => {
  const store = current.getStore();
  if (store) store.count++;
};
