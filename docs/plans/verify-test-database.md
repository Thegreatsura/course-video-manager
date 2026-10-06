# A non-production database for `verify-cvm`

Research only. No code, settings or infrastructure changed. Written so a human can
pick an option and an agent can implement it.

## The problem

`verify-cvm` (`.claude/skills/verify-cvm/`) launches `apps/local`'s dev server
against whatever `DATABASE_URL` the repo-root `.env` holds. Today that is
production, so:

- the skill is read-only by default and needs a **Write Ledger**
  (`pg_stat_user_tables` diffs plus forensics) to prove it changed nothing;
- `verify.sh` has to read `DATABASE_URL` out of `.env` (`db_url()`), and the
  launch step tells the agent to `ln -s ../../.env .env`. Both show up to the
  permission classifier as **Credential Exploration** and **Production Reads**,
  so it blocks the run, and features ship without a browser check;
- the Ledger's counters are database-wide. Matt's own instance, `apps/remote`
  and sibling runs all show up in each other's Ledgers.

A database the agent owns removes all three. The agent never touches a
production credential, writes become harmless, and each run can get its own
database.

## 1. How the database is hosted and connected

- **Provider: PlanetScale Postgres.** `docs/planetscale-cutover.md` is the
  cutover runbook (PS-5, London, daily backups kept 30 days). `verify.sh`
  matches `*psdb.cloud*` as "production" and sets `PGSSLROOTCERT=system`
  because PlanetScale rejects the connection otherwise.
- **Two connection strings** (`packages/core/db/database-url.ts`):
  `DATABASE_URL` is the PgBouncer pooler (port 6432) and every app query uses it.
  `DIRECT_DATABASE_URL` is the primary (5432) and is used only by migrations. It
  falls back to `DATABASE_URL`, so a local Postgres needs one variable.
- **Schema**: Drizzle, `packages/core/db/schema*.ts`, 30 tables, all prefixed
  `course-video-manager_` (`table-creator.ts`). 28 SQL migrations in
  `packages/core/db/migrations`, applied **by hand** with `pnpm db:migrate`
  (ADR 0026). The schema uses `COLLATE "C"`, generated `STORED tsvector`
  columns, GIN indexes, partial unique indexes and `text[]`. All of these run
  on stock Postgres 17 and on PGlite: the test suite already pushes the full
  schema into PGlite.
- **Size**: about 81 MB in total (cutover runbook, step 4). A dump and restore
  takes under a minute.
- **Branching**: PlanetScale Postgres has branches, but they are **not**
  Neon-style instant copy-on-write. A new branch is either schema-only, or
  created with **"Restore to new branch"** from a backup ("includes both the
  schema and the data for the selected backup"). That is a restore, not an
  instant fork. Each branch has its own connection credentials. Dev branches run
  on `PS-DEV`, start at about $5/month and are billed for the time they exist.
  ([PlanetScale docs: Branching](https://planetscale.com/docs/postgres/branching))
- **A clone script already exists**: `pnpm db:clone-local`
  (`apps/local/scripts/clone-db-to-local.sh`). It starts a `postgres:17` Docker
  container on port 5433 (`cvm-local-postgres`), dumps production into it and
  prints a local URL. It was written for testing migrations. It runs `pg_dump`
  inside the container to match the server's major version.

### How the app gets its database

- `packages/core/services/drizzle-service.server.ts`: `DrizzleService` builds
  `drizzle(new Pool({ connectionString: resolveDatabaseUrl() }))` with
  `drizzle-orm/node-postgres`. `apps/local/app/services/layer.server.ts`
  provides it with `DrizzleService.Default`. This is the only place the app opens
  a connection.
- **Env precedence works for us.** React Router's dev plugin does
  `Object.assign(process.env, vite.loadEnv(mode, envDir, ""))`, and `envDir` is
  the workspace root. Vite's `loadEnv` gives variables that already exist in the
  process priority over `.env` files. So `DATABASE_URL=… react-router dev`
  overrides `.env`, and in a worktree with **no** `.env` at all, the exported
  value is the only one. `apps/local/app/cli/env.ts` follows the same rule for
  the CLI ("an already-set process.env.DATABASE_URL WINS").

## 2. What the tests use, and could the dev server run on it?

- Vitest uses **PGlite** (`@electric-sql/pglite@0.3.16`, Postgres 17 compiled
  to WASM). `packages/core/test-utils/global-setup.ts` pushes the schema once
  with `drizzle-kit/api`'s `pushSchema`, `dumpDataDir`s the result to a tarball,
  and `createTestDb()` boots each file's PGlite from that snapshot. `apps/remote`
  tests do the same through `app.fetch`.
- **Could the dev server run on PGlite?** Yes, but it needs code. Two seams:
  1. A second `DrizzleService` implementation using `drizzle-orm/pglite`,
     selected when the URL is e.g. `pglite:///path/to/datadir`. Tests already
     cast the PGlite drizzle to `NodePgDatabase` with no trouble.
  2. Or leave the app alone and put `@electric-sql/pglite-socket` in front of
     it. That serves the Postgres wire protocol, so `DATABASE_URL` stays a
     normal `postgresql://` URL.

  Either way, PGlite is **one connection in one process**. A dev server firing
  parallel route loaders through a `pg.Pool` queues behind one connection, and
  long transactions block everything. It is fine for the test suite and less
  certain under a real UI.

- **Could it run on a local Postgres?** Yes, with no code change. The app reads
  a URL and nothing else. That is what `db:clone-local` already sets up, and
  until the cutover it was how the app ran every day.

What this machine has today: `psql`, `pg_dump` and `pg_restore` **16** (client
only, no server). Docker Desktop is installed on Windows, but its WSL
integration is **off**, so `docker` fails inside WSL. `pg_dump` 16 refuses to
dump a Postgres 17 server, which is why the clone script runs `pg_dump` inside
the container.

## 3. What a realistic seed needs

**Tables the verify flows touch** (`features/*.md`):

| Flow                        | Tables                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Course View                 | `course`, `course_version`, `section`, `lesson`, `video`, `learning_goal`                                            |
| Video Editor                | `video`, `clip`, `clip_transcript_word`, `chapter`, `beat`, `beat_learning_goal`, `overlay`, `clip_web_link`, `link` |
| Clip Mockups / Animatic     | `clip_mockup`, `clip_mockup_chapter`, `clip_mockup_comment`                                                          |
| Videos / Shorts lists       | `video`, `thumbnail`, `video_post`                                                                                   |
| Pitches                     | `pitch`, `deliverable_pitch`                                                                                         |
| Deliverables Calendar (`/`) | `deliverable`, `deliverable_course`, `deliverable_pitch`                                                             |
| Diagrams (not yet mapped)   | `diagram`, `diagram_snapshot`, `diagram_component`                                                                   |
| Publish (observe only)      | everything under a `course_version`                                                                                  |

Those foreign keys reach across nearly the whole schema, and the UI's value is
in real shapes: long Learning Goals, hundreds of Clips, real transcripts. A
hand-written fixture would be a large, permanent maintenance cost. **Copy the
whole database (about 81 MB) rather than write a fixture.**

**Leave out the credential tables' data**: `youtube_auth`, `ai_hero_auth`,
`dropbox_auth` and `api_token`. Use
`pg_dump --exclude-table-data='"course-video-manager_youtube_auth"'` and so on.
The copy then holds no OAuth refresh tokens or API token hashes, so it is not
itself a secret. A side effect we want: YouTube upload, AI Hero sync and
Dropbox publish all fail closed against the copy.

**Media and file paths.** The database stores _names_, not bytes. The bytes live
on Matt's disk:

- `clip.video_filename`: raw OBS footage, resolved against local directories.
- `VIDEO_FILES_DIR/{lineageId}/…`: per-Video scratch files (Article Writer
  context).
- `CLIP_MOCKUP_DIR/{lineageId}/…`: Animatic PNGs and WAVs.
- `DIAGRAM_THUMBNAILS_DIR/{diagramId}/…`, `OVERLAY_RENDER_CACHE_DIRECTORY`.
- `FINISHED_VIDEOS_DIRECTORY`: rendered `.mp4`s for Publish, which go to
  Dropbox.

None of these are needed to render the pages verify drives. A missing file shows
up as a broken thumbnail or a player that will not load, not as a 500. For a
writeable run, point the **writeable** directories (`VIDEO_FILES_DIR`,
`CLIP_MOCKUP_DIR`, `DIAGRAM_THUMBNAILS_DIR`, `OVERLAY_RENDER_CACHE_DIRECTORY`)
at a scratch directory inside the run dir, so a verify write cannot touch
Matt's real files either. Leave `FINISHED_VIDEOS_DIRECTORY`, Dropbox,
Anthropic, Google and AWS **unset**. Without the `.env` symlink they already
are, so Publish and Autofill cannot leave the box.

**One trap: `cvm` is not the database.** The `cvm` CLI reaches data over HTTP
through the deployed `apps/remote` (`CVM_API_URL`), which reads **production**.
SKILL.md's "read the row back with `cvm`" would check the wrong database. On
the test database, read back with `psql "$VERIFY_DATABASE_URL"`, through a new
`verify.sh sql` verb.

## 4. Options

Ranked by recommendation. Option C needs the least code and has the highest
fidelity, but it leaves the classifier problem half-solved.

### A. Local Postgres 17, one template database, one cloned database per run (recommended)

A local Postgres 17 holds `cvm_verify_template`, restored from a credential-free
dump. `verify.sh launch` runs
`CREATE DATABASE cvm_verify_<runid> TEMPLATE cvm_verify_template`. That is a
file-level copy, about a second for 81 MB. The dev server then starts with
`DATABASE_URL` pointing at the per-run database. `cleanup` drops it.

- **Fidelity**: high. Real Postgres 17, real data, real query planner. The only
  thing missing is PgBouncer, and no CVM code depends on it.
- **Effort**: low to medium. No app code changes. `verify.sh` changes, plus one
  snapshot script.
- **One-time human setup**:
  1. Get a Postgres 17 server into WSL. Either turn on Docker Desktop's WSL
     integration (Settings → Resources → WSL integration) and reuse the
     `cvm-local-postgres` container from `db:clone-local`, or
     `apt install postgresql-17` from the PGDG repo, which also brings
     `pg_dump` 17.
  2. Create a role that can create databases:
     `CREATE ROLE cvm_verify LOGIN CREATEDB PASSWORD '…'`.
  3. Write `~/.config/cvm/verify.env` holding only
     `VERIFY_DATABASE_URL=postgresql://cvm_verify:…@localhost:5433/cvm_verify_template`.
     It is a local-only credential for a throwaway database, and it sits outside
     the repo.
  4. Run the snapshot once, from Matt's own terminal, since it is the only step
     that touches production. This is `pnpm db:verify-snapshot`, a new script
     built from `clone-db-to-local.sh`: `pg_dump -Fc` with the four
     `--exclude-table-data` flags into `~/.cache/cvm/verify-seed.dump`, then
     `pg_restore` into `cvm_verify_template`.
- **How `verify.sh` selects it**: `launch` sources `~/.config/cvm/verify.env`,
  or takes `VERIFY_DATABASE_URL` from the environment. It **refuses** a URL
  whose host matches `psdb.cloud`, clones the template, and
  `exec`s the server with `DATABASE_URL=<per-run url>` exported. The
  worktree's `.env` symlink step is deleted. `doctor` reports "verify
  database `cvm_verify_<runid>`" and fails on any `psdb.cloud` host. `guard`
  stays as an optional diff, but per run it is no longer noisy.
- **Refresh**: Matt reruns `pnpm db:verify-snapshot` whenever he wants fresher
  data, weekly or after a big course push, or adds it to a cron on his
  machine. Runs started after that clone the new template. Schema drift: run
  `pnpm db:migrate` with `DIRECT_DATABASE_URL=$VERIFY_DATABASE_URL` against the
  template, so a PR's migration can be verified **before** it reaches
  production. Today that is impossible.
- **Classifier**: the agent's path never contains `.env`, `DATABASE_URL` or
  `psdb.cloud`. It reads one `localhost` URL from a file that holds nothing
  else, and writes to a database that only it uses. No Credential Exploration,
  no Production Reads.
- **Bonus**: sibling runs get separate databases, so the Write Ledger stops
  picking up other runs' writes, and the "Writing to production" rules shrink
  to "don't press Publish".

### B. PGlite-backed dev server (no server install)

Restore the same credential-free dump into a PGlite data directory once, then
`dumpDataDir` it into `~/.cache/cvm/verify-seed.tar` (the global-setup trick,
applied to real data). Each run boots PGlite from that tarball. Either a
`pglite:` URL with a PGlite `DrizzleService` variant, or `pglite-socket` on a
per-run port with an ordinary `postgresql://localhost:<port>` URL.

- **Fidelity**: medium. The SQL engine is the same Postgres 17, but it is
  single-connection WASM in the dev server's process. Concurrent loaders
  serialise, and memory holds all 81 MB plus indexes. `pg_stat_user_tables`
  counters in PGlite are untested, so the Ledger may not work, though with a
  private database it barely matters.
- **Effort**: medium, and it is code. A layer variant or socket wrapper, a
  build-seed script, and a long tail of "works in prod, hangs in PGlite"
  problems to chase. Getting real data into PGlite still needs a `pg_dump` 17
  of production in plain SQL, replayed through pglite-socket.
- **One-time human setup**: produce the dump, as in step 4 of option A. Nothing
  to install, because PGlite is already a dependency.
- **How `verify.sh` selects it**: `VERIFY_DATABASE=pglite`, defaulting to the
  cached tarball. `launch` exports `DATABASE_URL=pglite://<run dir>/pgdata`.
- **Refresh**: rerun the dump and the tarball build.
- **Classifier**: same as option A, since no production credential is in the
  path.
- **Why not first**: it trades a one-time `apt install` for permanent
  fidelity risk in the exact place (a real browser driving real loaders) that
  verify exists to test.

### C. PlanetScale dev branch restored from a backup

In the PlanetScale dashboard, Backups → pick last night's backup → "Restore to
new branch" (`verify`, `PS-DEV`), then create a role on that branch.

- **Fidelity**: highest. Same provider, same pooler, same extensions, same
  latency.
- **Effort**: lowest code. `verify.sh` only needs to read a different URL. The
  ongoing manual effort is the highest.
- **One-time human setup**: create the branch from a backup, create a branch
  role, and put its URL in `~/.config/cvm/verify.env` as `VERIFY_DATABASE_URL`.
  The credential tables' data comes along with the backup, so truncate
  `youtube_auth`, `ai_hero_auth`, `dropbox_auth` and `api_token` on the branch
  by hand.
- **How `verify.sh` selects it**: the same `VERIFY_DATABASE_URL`. `doctor`
  would have to tell the branch host apart from production by more than
  `psdb.cloud`.
- **Refresh**: delete the branch and restore a newer backup by hand (or
  scripted with `pscale`). That is a restore each time, not an instant fork,
  and the credentials change every time.
- **Classifier**: only partly fixed. The agent no longer reads the production
  `.env`, but it still holds a `*.psdb.cloud` credential with the same shape
  as production. A classifier, or a human, can't tell the two apart at a
  glance. All runs share one branch, so the Ledger's noise remains. It also
  costs about $5+/month.

## Recommendation

**Option A.** It has real-Postgres fidelity, needs no app code, and its
per-run `CREATE DATABASE … TEMPLATE` is the only option that isolates sibling
runs from each other. It is also the only option that removes every
production-shaped string from the agent's path. The human's part is four steps,
done once (enable Docker WSL integration or install PG 17, create the role,
write `~/.config/cvm/verify.env`, run the snapshot), plus a snapshot rerun when
fresher data is wanted.

Follow-up work, for an implementation PR: `scripts/verify-snapshot.sh` (from
`clone-db-to-local.sh`, credential tables excluded); `verify.sh` gains
`VERIFY_DATABASE_URL`, template clone/drop, a `psdb.cloud` refusal and a `sql`
read-back verb, and loses `db_url()`'s `.env` read; SKILL.md drops the `.env`
symlink step and the "database is production" framing, and replaces the `cvm`
read-back with `verify.sh sql`.
