---
name: verify-cvm
description: "Drive the real Course Video Manager web app in a browser and capture proof of what it did. Use to verify a change before opening a PR, to reproduce a reported UI bug, to see what a page actually renders, or to capture a screenshot of app behaviour. Runs on a per-run, writable clone of a local copy of Matt's data by default — click anything that mutates; production is never written to."
---

# Verify CVM

You start a Course Video Manager of your own, drive it through a browser the
way Matt does, and leave behind evidence a human can read without rerunning
anything.

## Your database: a clone of your own

Every run gets **its own copy of Matt's data**. `launch` clones the local
template database `cvm_verify_template` (on the `cvm-local-postgres` container,
port 5433) into a database only this run uses, starts the server on it, and
`cleanup` drops it:

```text
launch: cloned cvm_verify_template into cvm_verify_20261007_094829_712617
template: 0 day(s) old (as of 2026-10-06T18:56:11Z, from the snapshot stamp)
DB: test clone cvm_verify_20261007_094829_712617 (writes allowed, dropped on cleanup)
```

So **writes are allowed — verify the write path for real.** Create, edit,
reorder, archive, delete: press the button that mutates and then read the row
back. Nothing you do can reach Matt's data, his files or the outside world:

- The data is a copy, minus the credential tables. Nothing else writes to it,
  so every row in your [Write Ledger](#the-write-ledger) is yours.
- File writes (Video files, Clip Mockups, renders, finished videos) go to
  `scratch/` in the run directory, never Matt's disk.
- Every external service's credential is replaced with a dud, so Buffer, S3,
  Dropbox, YouTube, OpenAI, Anthropic and AI Hero all fail closed. A feature
  whose point is an external call shows its error path here, not its success.
- No `.env` is needed. Do not link one.

**Never write to production.** Production is reachable only by asking for it
by name — `$V launch --production` — and even then the server's own connections
are read-only (`default_transaction_read_only`), so a write comes back a 500
instead of landing. Use it only to _look at_ data newer than the template (a bug
Matt reported on something he made this morning), never to test a write. See
[Production, read-only](#production-read-only).

### If the template is missing, or old

`launch` fails rather than guess when there is no template:

```text
FAIL: the verify template database cvm_verify_template does not exist on localhost:5433.
  Stop and ask Matt to run:  pnpm db:verify-snapshot
```

Do exactly that: stop and ask Matt. **Never run `pnpm db:verify-snapshot`
(`scripts/verify-snapshot.sh`) or `scripts/setup-verify-db.sh` yourself** — the
snapshot is the one step that reads production, only Matt runs it from his own
terminal, and both refuse an agent's shell. Do not fall back to `--production`
on your own either. If Postgres itself is unreachable, `docker start
cvm-local-postgres` is fine.

Read the template's age before you rely on recent data:

```bash
$V template      # exists? how big? how old?
```

```text
template: cvm_verify_template on localhost:5433 — 95 MB
template: 0 day(s) old (as of 2026-10-06T18:56:11Z, from the snapshot stamp)
```

The age comes from the stamp `pnpm db:verify-snapshot` leaves on the template,
or — for a template made before it stamped — the newest `created_at` /
`updated_at` in it. `launch` prints the same line. At **14 days or more** it
warns and carries on; nothing fails. Carry on with your verification, and say
in your report that the template wants `pnpm db:verify-snapshot` (Matt's to
run). Anything Matt made after the "as of" time is not in your clone.

The one thing a run always produces is a **Write Ledger** — a per-run record of
every insert, update and delete the database took while you were driving.

The harness is one script. Every command below is a verb of it:

```bash
.claude/skills/verify-cvm/scripts/verify.sh   # prints its own usage
```

## Launch

The checkout you drive must be your own — a worktree, not Matt's working copy.
It needs `node_modules`, which Git does not carry:

```bash
pnpm install                 # ~seconds from the pnpm store
```

```bash
V=.claude/skills/verify-cvm/scripts/verify.sh
$V launch
```

Every launch first sweeps up clones that crashed runs left behind — in this
checkout or any sibling worktree — so you never need to tidy someone else's.

**Verification runs live in 5200-5299, and the CVM never does.** The CVM owns
5170-5199 — 5172 is the Stream Deck forwarder hub, 5173 Matt's own dev server,
5174 the forwarder's HTTP side — and its dev server is pinned to 5173 so it can
never drift upward into your band. `launch` takes the first free port of the
verification band, asks for exactly it, and refuses a server that comes up
anywhere else. It prints the port along with the **run directory** that holds
the pid, the port, the browser session name, the server log and all your
evidence:

```text
DB: test clone cvm_verify_20260925_160913_1328614 (writes allowed, dropped on cleanup)
ready:   http://localhost:5203/  (pid 1328618)
run:     /…/.verify/run-20260925-160913-1328614
session: verify-cvm-20260925-160913-1328614
export VERIFY_RUN=/…/.verify/run-20260925-160913-1328614
```

**Run that `export` line.** Every later verb needs to know which run you mean.

Then take the two addresses from the harness rather than writing them down:

```bash
export VERIFY_RUN=<the directory launch printed>
BASE=$($V url)                              # http://localhost:<this run's port>
AB="agent-browser --session $($V session)"  # this run's own browser
```

### Several runs at once

Runs are independent by construction: each has its own port out of 5200-5299,
its own browser session, its own database and its own evidence directory. There
is no shared "current run" pointer, so launching a second one never disturbs
the first. With more than one run live, every verb **requires `VERIFY_RUN`** and
refuses to guess; with exactly one, it finds it for you.

## Doctor

Run it after launch, and again the moment anything looks wrong:

```bash
$V doctor
```

It reports, read-only: the server process alive, the run's port outside the
CVM's band, the port owned by _this_ run's pid, `/` answering 200, which database the run is on (`DB: test clone …` or
`DB: PRODUCTION …`), psql reaching it,
and which other verification runs are live. Any FAIL means stop and fix — a
snapshot taken against someone else's server proves nothing.

**Drive only the port your own run reports.** 5173 is Matt's CVM: it runs all
day against the production database, and driving it would type into the
window he is looking at. `doctor` fails outright on any port in 5170-5199 for
that reason. Other ports in the verification band belong to sibling runs.

## Drive

`agent-browser` is the harness. Load its own guide once per session before
driving:

```bash
agent-browser skills get core
```

Always go through `$AB` and `$BASE` from the launch step, so your browser and
your server are both this run's:

```bash
$AB open "$BASE/"
$AB snapshot -i -c -d 4
```

Three things about this app specifically:

- **Navigate by URL, not by the sidebar.** The sidebar renders as a collapsed
  rail; its course links appear in the snapshot but a click on one does not
  navigate. Read the href with `snapshot -i -u`, then `open` it.
- **Drive by role and text.** There is one `data-testid` in the whole app, so
  stable handles are ARIA roles, accessible names and route paths — `$AB find
role button click --name "Publish"`, `$AB find text "All Lessons" click`.
- **Scope every snapshot.** A course page carries whole Learning Goals and
  descriptions in its accessibility tree; an unscoped `snapshot` runs to tens of
  thousands of tokens. Use `-i -c`, cap with `-d 3`, or scope with `-s
"<selector>"`.

[`features/`](features/README.md) maps the app's user-facing features: how to
reach each one, how to drive it, and what end state proves it works. Read the
index before you decide a feature is verified — a proof that drives one
convenient page is incomplete when the map lists three more entry points into
the same behaviour.

## The Write Ledger

Open the window before you drive, close it after:

```bash
$V guard baseline     # before the first browser command
# ... drive ...
$V guard check        # writes WRITE-LEDGER.md into the run directory
$V guard forensics course-video-manager_pitch   # name the rows behind a line
```

`guard` reads `pg_stat_user_tables`, Postgres's own count of the inserts,
updates and deletes each table has taken. It costs a catalog read, never a table
scan, so run it around every drive. `forensics` prints every row of one table
whose `created_at` or `updated_at` falls inside your window, into
`forensics-<table>.txt`.

On a clone the database is this run's alone, so every moved counter is your own
write, and the Ledger is your record of them:

```text
guard: writes landed in this run's test clone (allowed) — see …/WRITE-LEDGER.md
course-video-manager_pitch|1|1|0
```

Check each table it names is one you meant to write, and report any you did
not expect — a button that writes three tables when it should write one is a bug
the run found.

## What not to press

Two buttons stay off limits **even on a clone**, because their job is to leave
the database: **Submit** on the publish page (`/courses/:id/publish`) ships a
Bundle to Dropbox, and **Autofill** on that same page calls Anthropic. A clone
run's credentials are duds, so both should fail closed — but nobody has proved
every leg does. Observe them, screenshot them, read their counts — press
nothing.

## Production, read-only

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
- **The Ledger is your proof you changed nothing**, and its counters are
  **database-wide**: Matt's own instance, the deployed `apps/remote` and sibling
  production runs all write to the same tables, so a moved counter is a lead,
  not a verdict. Run forensics on it, and keep the window tight — `guard
baseline` immediately before driving, not at launch. `doctor` names the other
  live runs for this reason.
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

## Evidence

Everything lands in the run directory `launch` printed. What makes it a proof:

- **The real user path.** Reach a feature the way Matt reaches it — the route,
  the button. An internal API call you crafted proves the API, not the app.
- **The action and its result.** Capture the state before your action and the
  state after, not only the final screen. `$AB screenshot "$VERIFY_RUN/<step>.png"`
  and `$AB snapshot -i -c > "$VERIFY_RUN/<step>.snapshot.txt"`.
- **The side effect too.** A page that looks right over a row that did not
  change is a failure. Check the Ledger, and read the row back where the change
  was meant to persist: `$V sql 'select … from "course-video-manager_video"
where …'` (or the query on stdin). It reads this run's clone, read-only, and
  logs the query and result to `sql.log` in the run directory. **Do not use
  `cvm` to read a clone's rows** — it reads production through the deployed
  `apps/remote`. That makes it the right tool for the opposite proof: a `cvm`
  lookup that does NOT find your new row shows the write stayed in the clone.
- **The console.** `$AB errors` and `$AB console` catch the hydration failure a
  screenshot renders straight through.

Name files after the step. A human reading the directory in order should be able
to follow what you did.

## Cleanup

```bash
$V cleanup          # this run
$V cleanup --all    # every live run on the box
```

It kills the pid this run recorded — never a process matched by name, which
would take Matt's server and every sibling run with it — closes this run's
browser session, **drops the run's clone**, and leaves the rest alone. `--all`
also sweeps the clones crashed runs left behind (as every `launch` does): any
whose run is no longer live, in any worktree, and any unclaimed, unconnected
`cvm_verify_*` database over six hours old. **The evidence survives**: the run
directory is left whole, and its path is printed. Quote that path in your
report.

Run cleanup after a failed attempt too, so a broken run leaves no server holding
a port.
