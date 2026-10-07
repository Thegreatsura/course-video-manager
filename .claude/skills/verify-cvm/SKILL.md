---
name: verify-cvm
description: "Drive the real Course Video Manager web app in a browser and capture proof of what it did. Use to verify a change before opening a PR, to reproduce a reported UI bug, to see what a page actually renders, or to capture a screenshot of app behaviour. Runs on a per-run test clone when ~/.config/cvm/verify.env exists, otherwise on the PRODUCTION database — check which before driving."
---

# Verify CVM

You start a Course Video Manager of your own, drive it through a browser the
way Matt does, and leave behind evidence a human can read without rerunning
anything.

## Which database: test clone or PRODUCTION

`launch` runs in one of two modes, prints which, and records it in the run
directory so the run never drifts into the other:

```text
DB: test clone cvm_verify_20261006_141502_88231 (writes allowed, dropped on cleanup)
DB: PRODUCTION (read-only rules apply)
```

- **Test clone** — when `~/.config/cvm/verify.env` (or an exported
  `VERIFY_DATABASE_URL`) names the local template database. `launch` clones the
  template into a database of the run's own, starts the server on it, and
  `cleanup` drops it. The data is a recent copy of Matt's real work minus the
  credential tables, so **writes are allowed**: they land in a database only
  this run uses. The [Write Ledger](#the-write-ledger) is per run, and every row
  in it is yours. No `.env` is needed, and file writes go to `scratch/` in the
  run directory.
- **PRODUCTION** — when neither is set. Every Course, Video, Clip and
  Deliverable you see is Matt's real work, so the skill is **read-only by
  default**, and the Write Ledger is the proof you changed nothing. Read
  [Writing to production](#writing-to-production) before you touch anything.

`$V mode` prints which mode `launch` would use without connecting to anything.

**Never run `scripts/verify-snapshot.sh` (`pnpm db:verify-snapshot`) or
`scripts/setup-verify-db.sh`.** The snapshot is the one step that reads
production; only Matt runs it, from his own terminal, and both scripts refuse an
agent's shell. If `launch` says the template is missing or Postgres is
unreachable, stop and tell Matt — do not work around it by falling back to
production on your own.

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

**Production mode only** also needs `.env`, which holds `DATABASE_URL`; without
it the server starts and every page 500s. `ln -s ../../.env .env` from a
`.worktrees/<name>` worktree (adjust the depth otherwise). In test-clone mode
**do not** link `.env`: `launch` exports the clone's URL itself, and `.env`
would only load production's Dropbox and Anthropic keys into your server.

```bash
V=.claude/skills/verify-cvm/scripts/verify.sh
$V launch
```

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
its own browser session and its own evidence directory. There is no shared "current run"
pointer, so launching a second one never disturbs the first.

Two consequences:

- With more than one run live, every verb **requires `VERIFY_RUN`** and refuses
  to guess. With exactly one, it finds it for you.
- In production mode the Write Ledger's counters are database-wide, so
  **sibling runs show up in each other's Ledgers**. `doctor` names the other
  live runs for exactly this reason. Read [the Write Ledger](#the-write-ledger)
  on how to resolve one. Test-clone runs each have their own database, so they
  never see each other.

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
```

`guard` reads `pg_stat_user_tables`, Postgres's own count of the inserts,
updates and deletes each table has taken. It costs a catalog read, never a table
scan, so run it around every drive.

**In test-clone mode** the database is this run's alone, so every moved
counter is this run's own write. Writes are allowed; the Ledger is your record
of them. Check each table it names is one you meant to write, and report any
you did not expect — that is a bug the run found. Forensics works the same way.

**In production mode** the counters are **database-wide**: Matt's own instance, the deployed
`apps/remote` and every sibling verification run write to the same tables. So a
moved counter is a lead, not a verdict. Name the rows behind it:

```bash
$V guard forensics course-video-manager_video
```

That prints every row of the table whose `created_at` or `updated_at` falls
inside your window, into `forensics-<table>.txt`. Keep your window tight — run
`guard baseline` immediately before driving, not at launch — so fewer of
somebody else's rows fall inside it.

**The `api_token` line is background, not a write.** Every `cvm` call, from
any agent anywhere, authenticates against the deployed `apps/remote`, and a
successful authenticate bumps that token's `last_used_at`. So in production
`course-video-manager_api_token` takes updates in almost every window, none of
them yours. `guard` fingerprints every token row minus `last_used_at` at
baseline and at check. When the table took only updates and every id and
fingerprint is unchanged, the Ledger prints it on its own line instead of in
the writes table:

```text
Background (apps/remote token usage — expected): course-video-manager_api_token: 2 update(s), last_used_at only (tokens: cvm_ece4b913).
```

Do not run forensics on that line or report it. Anything else on `api_token`
— an insert, a delete, a revoke, a changed name or expiry — still lands in
the writes table like any other table and gets the full treatment below.

**In production mode, report a non-clean Ledger to Matt in your reply, at the top, before anything
else** — the table, the row ids from forensics, and what you were driving at the
time. Say plainly whether you believe it was you, his own instance, or a sibling
run. This holds even when you are confident it was not you: he asked to hear
about it either way, and a false alarm costs him one glance.

## Writing to production

These rules are for **production mode**. In test-clone mode, write whatever the
verification needs — create, edit, reorder, archive, delete — and skip the
three rules below. The off-limits pages still hold in both modes: see the last
paragraph.

Reading proves most things. When a change genuinely needs a write to verify —
a form submit, a reorder, a status toggle — three rules hold:

1. **Create something new; never edit something that exists.** Title it
   `ZZ-VERIFY-<timestamp>` so it sorts to the bottom of every list and reads as
   scaffolding to a human who finds it.
2. **Write down what you created**, id and all, in `run.txt` in the run
   directory, before you create the next thing.
3. **Archive it before cleanup**, through the same UI path a user would take.
   Most CVM nouns soft-delete (`archived`), so the row survives — say so in your
   report rather than claiming you removed it.

Two pages are off limits to writes entirely, **in both modes**, because their
writes leave the database: the **publish page** (`/courses/:id/publish`) Submits a Draft Version
and ships a Bundle to Dropbox, and **Autofill** on that same page spends
Anthropic tokens rewriting real Video descriptions and Chapters. Observe them,
screenshot them, read their counts — press nothing.

## Evidence

Everything lands in the run directory `launch` printed. What makes it a proof:

- **The real user path.** Reach a feature the way Matt reaches it — the route,
  the button. An internal API call you crafted proves the API, not the app.
- **The action and its result.** Capture the state before your action and the
  state after, not only the final screen. `$AB screenshot "$VERIFY_RUN/<step>.png"`
  and `$AB snapshot -i -c > "$VERIFY_RUN/<step>.snapshot.txt"`.
- **The side effect too.** A page that looks right over a row that did not
  change is a failure. Check the Ledger, and read the row back where the change
  was meant to persist:
  - **test clone**: `$V sql 'select … from "course-video-manager_video" where …'`
    (or the query on stdin). It reads this run's clone, read-only, and logs the
    query and result to `sql.log` in the run directory. **Do not use `cvm` here**
    — it reads production through the deployed `apps/remote`, so it cannot see
    your clone's rows.
  - **production**: read the row back with `cvm`. `sql` refuses production runs.
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
browser session, **drops the run's test clone** in test-clone mode, and leaves
the rest alone. `--all` also drops clones left behind by runs whose server
already died. **The evidence survives**: the run
directory is left whole, and its path is printed. Quote that path in your
report.

Run cleanup after a failed attempt too, so a broken run leaves no server holding
a port.
