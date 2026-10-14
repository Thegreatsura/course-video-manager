---
status: accepted
---

# Tests share one Postgres container, with a database per test file

Asked for by Matt on 2026-10-14: the test suite and `pnpm check` had crashed WSL more than once. Replaces the PGlite half of ADR 0014. The vitest project split stays.

## Context

Every DB-backed test file booted its own in-process PGlite (Postgres compiled to WASM). A fork never closed it, and under `isolate: false` it lived on into the worker's next files until GC. Measured under a memory cap, `nice`, 8 cores:

- One PGlite costs about **370 MB RSS**, and about 200 MB more for each one still alive. A single `packages/core` worker grew to **1.3 GB**.
- `packages/core`'s suite peaked at **4.8 GB** with 5 forks and 1.5 GB with 1, so roughly 0.85 GB per worker, nearly all of it PGlite. `apps/local` peaked at 3.4 GB. The global setup booted one more PGlite to build the snapshot.
- tsc (3.9 GB, turbo runs the packages' typechecks in parallel) and oxlint (3.2 GB) are big but short, and `check` already runs them one after another, never alongside the tests.

So one `pnpm check` peaked at about 5.3 GB. Agents run `check` in parallel worktrees, so five of them come to about 25 GB before the app, Docker Desktop and the browser.

## Decision

1. **One Postgres server for every test run: the `cvm-test-postgres` container** (postgres:17, `127.0.0.1:54329`, data on a tmpfs, `fsync=off`, capped at 3 GB). The vitest global setup starts it if it is not running and reuses it otherwise, across runs and worktrees. If Docker is down the run fails at once and says why. `CVM_TEST_DATABASE_URL` points the suite at another _local_ server. Sandcastle sandboxes use it to reach the host's container through `host.docker.internal`.
2. **Each run builds a TEMPLATE database once** (`drizzle-kit` `pushSchema`, as before). `createTestDb()` clones it with `CREATE DATABASE … TEMPLATE`, so each test file gets its own database: a file copy, not a replay of the DDL. Tests still reset between cases with `truncateAllTables`.
3. **Databases are dropped when their file ends.** A setup file's `afterAll` drops them, so a worker never holds more than one file's databases. Teardown drops the run's databases. The next run sweeps up after a run that was killed: it drops any database whose run's process is gone, on this machine only.
4. **Test code reaches the database through `node-postgres`, the driver production uses.** PGlite and its dependency are gone.

## Considered alternatives

- **Close each PGlite after its file, and cap the forks.** This stops the pile-up, but every worker still carries one PGlite (about 370 MB). It saves memory by giving up parallelism.
- **One PGlite per worker with a schema per file.** This keeps the WASM heap per worker, and PGlite serialises every query in a worker anyway.
- **A schema per file in one database.** Isolation is as good, but `search_path` has to be threaded through every pool. Template clones are just as fast and need nothing threaded.
- **A Postgres per worker, or testcontainers.** This multiplies servers where one is enough, and adds a dependency.

## Consequences

- Measured under the same cap (before → after): `packages/core` suite **4.8 GB / 14.5 s → 0.9 GB / 7.0 s**; `apps/local` **3.4 GB / 136 s → 1.9 GB / 121 s**. The full `pnpm check` figures are in the PR. The container itself idles at about 200 MB inside Docker Desktop's VM.
- **Docker Desktop must be running** for any DB-backed test. CI's `ubuntu-latest` has Docker, and the same global setup starts the container there.
- Tests now run on real Postgres over real connections (a pool of 4 per file; PGlite was one serial session). This found an order bug: `listClipMockupsToVoice` returned rows in whatever order the join produced. It also found two tests that relied on PGlite always winning a race. Expect more of the same: fix the query or the race, not the database.
- `createBlankDb()` is now async and returns `{ db, client, close }`. `createTestDb()` returns `{ testDb, client, close }`. `withQueryLog` takes the `client`.
