# Production, read-only

`$V launch --production` starts the server on production instead of a clone.
Reach for it only when the data you must look at is newer than the template,
and only to look. It needs `.env` (`ln -s ../../.env .env` from a
`.worktrees/<name>` worktree; adjust the depth otherwise), and launch prints:

```text
DB: PRODUCTION (read-only: the server cannot write)
```

- **The server cannot write.** Its connections run with
  `default_transaction_read_only`, so any write — yours or a stray click — comes
  back a 500 (`PreventCommandIfReadOnly`). A write path you need to verify goes
  on a clone, never here.
- **The Ledger is your proof you changed nothing**, and its verdict is this
  run's own statements: `[cvm-sql]` lines with no write among them read
  `clean — this run's server sent no write statement`. A write statement reads
  `WRITE ATTEMPTED ON PRODUCTION (refused by read-only)`; anything that tries to
  lift the read-only guard reads `READ-ONLY OVERRIDE ATTEMPTED` — tell Matt at
  once. No `[cvm-sql]` lines at all reads UNKNOWN.
- **The database-wide counters are a lead on other writers, never the
  verdict.** Matt's own instance, the deployed `apps/remote` and sibling
  production runs write to the same tables, and the counters lag, so a moved
  counter may be someone else's and an unmoved one proves nothing. Run
  forensics on a moved one, and keep the window tight — `guard baseline`
  immediately before driving, not at launch. `doctor` names the other live runs
  for this reason.
- **The `api_token` line is background, not a write.** Every `cvm` call
  authenticates against `apps/remote` and bumps that token's `last_used_at`.
  `guard` fingerprints every token row minus `last_used_at`; when only that
  moved, the Ledger prints it on its own line —
  `Background (apps/remote token usage — expected): …` — rather than in the
  writes table. Do not run forensics on it or report it. Anything else on
  `api_token` is a write like any other.
- **Report a non-clean Ledger to Matt at the top of your reply**, before
  anything else — the table, the row ids from forensics, what you were driving
  at the time, and whether you believe it was you, his own instance, or a
  sibling run. This holds even when you are sure it was not you.
- **Read rows back with `cvm`**, not `sql`, which refuses production runs.
