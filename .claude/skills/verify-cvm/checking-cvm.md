# Checking a `cvm` command

**To check a `cvm` command, use `$V cvm <run> <args…>`. Never mock the gates.**
Plain `cvm` from a worktree refuses its local-only verbs, and its transport is
the deployed API — production. `$V cvm` runs this checkout's real `cvm` against
this run's clone and nothing else:

```bash
$V cvm <run> course list
$V cvm <run> diagram create --file tiny.json   # prints the Diagram's url on this run's app
```

- **Its own API.** The first call starts the run's own `apps/remote`
  (`apps/local/scripts/verify-api.ts`) on `127.0.0.1` against the clone, mints
  a one-day token in the clone, and keeps both for later calls (`api.json`,
  `api.log` in the run directory). Cleanup stops it.
- **The gate opens for the clone only.** `cvm` gets `CVM_VERIFY_CLONE=<clone>`,
  the clone's `DATABASE_URL` and scratch directories, and `CVM_APP_URL` at this
  run's server. A worktree passes the local-only gate only while the API URL is
  loopback http and `DATABASE_URL` is a loopback host naming that clone
  (`apps/local/app/cli/verify-clone.ts`); anything else is refused before a
  request is sent. Matt's main checkout and every other box keep the gates
  they had.
- **It refuses production.** `$V cvm` asserts the API is loopback and the
  database is this run's clone before it starts anything, and refuses a
  `--production` run outright.
- **Its writes are in the Ledger** as another connection, `cvm-verify-api`.
- **The first `diagram create` on a fresh run can time out** while Vite
  compiles the render page for the first time. Run it again.

Read its result back with `$V sql`, or in the browser: a Diagram's url opens on
this run's app.
