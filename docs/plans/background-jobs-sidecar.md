# Background jobs move to a sidecar

**Status:** Batches 1-5 are done (batch 4, posting: section 7.7; batch 5, Course Autofill: section 7.8). Matt's decisions are in section 6;
where they differ from the recommendations in sections 3 and 5, section 6 wins,
and section 7 records the existing behaviour the sidecar copies, with file and
line, as found on 2026-10-08.

Move every **background job** (work the author starts and walks away from) out of the browser and out of the
HTTP request that runs it today. A **sidecar** process takes the jobs from a durable job table, runs them,
logs each one, and publishes **job events**. The UI subscribes to those events through a reducer.

ADR 0024 already names this as "the intended next step" ("A durable background worker. Deferred, not rejected
… A real job queue is the intended next step"). ADR 0031's Clip Mockup daemon is the in-repo precedent for a
long-lived process tied to its checkout.

Paths are under `apps/local/app/` unless stated. `S/` = `services/`, `R/` = `routes/`, `UM/` = `features/upload-manager/`.

## 1. Inventory

**Finding:** the server has no background work. There is no `runFork` or `forkDaemon` in any route, no cron,
no server-side `setInterval` and no file watcher. Every long job is one HTTP request, usually SSE through
`lib/create-sse-response.server.ts`, and a browser queue keeps it alive. When the client disconnects,
`cancel()` aborts the signal and interrupts the fiber (L82-86), so **the job dies with the tab**.

| #   | Job                                                                                                                      | Driven from                                                 | State, and where                                                     | Tab closes / server restarts                                                                                | Retry                                                                               | Errors go to                                                                                         | Key files                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | YouTube upload                                                                                                           | Upload Manager → SSE                                        | React memory                                                         | Job interrupted; upload lost                                                                                | Client re-runs, 3 attempts                                                          | Toast + row                                                                                          | `UM/sse-upload-client.ts`, `R/api.videos.$videoId.upload.ts`, `S/youtube-upload-service.ts`                                                                                                           |
| 2   | Buffer social post                                                                                                       | Upload Manager → SSE                                        | React memory                                                         | Lost                                                                                                        | 3 attempts                                                                          | Toast                                                                                                | `UM/sse-social-client.ts`, `R/api.videos.$videoId.post-social.ts`, `S/buffer-posting-orchestration.server.ts`                                                                                         |
| 3   | YouTube Shorts post                                                                                                      | Upload Manager → SSE                                        | React memory                                                         | Lost                                                                                                        | 3 attempts                                                                          | Toast                                                                                                | `UM/sse-youtube-shorts-client.ts`, `R/api.videos.$videoId.post-youtube-shorts.ts`                                                                                                                     |
| 4   | AI Hero post                                                                                                             | Upload Manager → SSE, may wait on another job (`dependsOn`) | React memory (`dependsOn` too)                                       | Lost; jobs waiting on it never start                                                                        | 3 client attempts + server `MAX_RETRIES`                                            | Toast                                                                                                | `UM/sse-ai-hero-client.ts`, `R/api.videos.$videoId.post-ai-hero.ts`, `S/ai-hero-upload-service.ts`                                                                                                    |
| 5   | Skills Changelog post                                                                                                    | Same as #4                                                  | React memory                                                         | Lost                                                                                                        | Same as #4                                                                          | Toast                                                                                                | `UM/sse-skills-changelog-client.ts`, `R/…post-skills-changelog.ts`                                                                                                                                    |
| 6   | Video export (ffmpeg passes + **Overlay render** through Remotion `bin.mjs` + composite)                                 | Upload Manager → SSE                                        | Content-addressed export file + sha256 sidecar; Overlay Render Cache | ffmpeg killed by scope; a parent SIGKILL orphans it; partial output lost. Re-running resumes from the cache | 3 attempts (terminal inside a Publish)                                              | Toast with a **generic** `ExportError`; real cause in `.data/logs/<videoId>.log` + stdout `logError` | `UM/sse-export-client.ts`, `R/api.videos.$videoId.export-sse.ts`, `S/course-publish-export-video.ts`, `S/overlay-render-cache.server.ts`, `S/overlay-content-renderer.ts`, `S/video-export-passes.ts` |
| 7   | Batch export                                                                                                             | Upload Manager (one child row per Video) → SSE              | React memory + export files                                          | Lost; finished files survive                                                                                | Per child                                                                           | Toast                                                                                                | `UM/sse-batch-export-client.ts`, `R/api.courseVersions.$versionId.batch-export-sse.ts`                                                                                                                |
| 8   | Vertical Shorts render (concat → Whisper **subtitles** → Remotion overlay → composite)                                   | Upload Manager → SSE                                        | `tmpdir()/cvm-overlay-render`                                        | Lost                                                                                                        | 3 attempts                                                                          | **Toast only**: `RenderVerticalError` carries the stderr to the SSE event and is never logged        | `UM/sse-render-vertical-client.ts`, `R/api.videos.$videoId.render-vertical-sse.ts`, `S/render-vertical-video-service.ts` L204-256, `lib/subtitle-chunks.ts`                                           |
| 9   | **Publish** (Submit → export → Dropbox upload → `course.json` receipt → Promote). Dropbox sync is only ever part of this | Upload Manager → SSE                                        | `course_version.commit_state` (Pending), Dropbox receipt             | Pending Version stranded; publish page offers Promote/Discard by hand (`S/pending-recovery.server.ts`)      | Dropbox `recurs(1)` + HTTP `recurs(5)`, export `recurs(2)`; a failure auto-Discards | Toast "status may be unknown, refresh"; every child row failed                                       | `UM/sse-publish-client.ts`, `R/api.courses.$courseId.publish-sse.ts`, `S/course-publish-service.ts`, `S/dropbox-http-client.ts`                                                                       |
| 10  | Course **Autofill**                                                                                                      | Upload Manager → SSE                                        | React memory; one transaction per Video                              | Lost partway; finished Videos stay written                                                                  | Backoff `recurs(3)` per Video; 6 Videos at a time                                   | Toast                                                                                                | `UM/upload-type-autofill.ts`, `R/api.courses.$courseId.autofill-sse.ts`, `S/autofill-service.ts`                                                                                                      |
| 11  | Autofill chapters (one Video)                                                                                            | Modal `EventSource`                                         | `useState`                                                           | Closing the modal stops it                                                                                  | None                                                                                | Inline in the modal                                                                                  | `features/video-editor/components/autofill-chapters-modal.tsx`, `R/api.videos.$videoId.autofill-chapters.ts`                                                                                          |
| 12  | Clip transcription (Whisper)                                                                                             | Clip reducer effect → awaited POST                          | `clip.transcription_status` (the only queue-like column)             | Rows stuck in `queued`/`transcribing`; nothing sweeps them                                                  | None                                                                                | `failed` + `logWarning`                                                                              | `features/video-editor/edit-effect-handlers.ts` L64-91, `R/clips.transcribe.ts`, `S/video-processing-service.ts`                                                                                      |
| 13  | OBS clip ingestion                                                                                                       | Browser `while(!unmounted)` loop, every 500 ms              | Clip rows; per-Video mutex                                           | Ingestion stops                                                                                             | Loops forever                                                                       | **Swallowed**, except draft-version errors                                                           | `edit-effect-handlers.ts` ~L265-305, `S/clip-service-handler.helpers.ts` L208-255                                                                                                                     |
| 14  | AI streaming (Article Writer, completions, suggest-next-clip)                                                            | `useChat` / stream                                          | Memory                                                               | Lost                                                                                                        | Manual regenerate                                                                   | Inline                                                                                               | `features/article-writer/use-writer-turn.ts`, `R/videos.$videoId.completions.ts`                                                                                                                      |
| 15  | `cvm course publish`                                                                                                     | CLI, in-process                                             | Same as #9                                                           | Same as #9                                                                                                  | Same as #9                                                                          | Exit 3/4 + JSON                                                                                      | `cli/commands/course-publish.ts`                                                                                                                                                                      |
| 16  | Footage transcription                                                                                                    | CLI                                                         | Files                                                                | Lost                                                                                                        | —                                                                                   | CLI                                                                                                  | `cli/commands/footage.ts`, `S/footage-transcription.ts`                                                                                                                                               |
| 17  | Clip Mockup daemon (Kokoro + Chromium)                                                                                   | Detached daemon, Unix socket                                | Memory, lock file                                                    | CLI restarts it on demand                                                                                   | Ping retry                                                                          | Daemon log file                                                                                      | `S/clip-mockup-daemon/*`, ADR 0031                                                                                                                                                                    |

These are not jobs, but each is a loop: `use-focus-revalidate.ts` (every 5 s on the section page, every 2 s on the animatic page), teleprompter polls, the diagram heartbeat, the 1 s ETA tick, and the Stream Deck forwarder (a separate process; main checkout only).

**Totals:** 17 jobs. 14 are driven from the browser and die with the tab. 3 run from the CLI or a daemon. The 9 that matter (#1-#10, less #7, which is #6 batched) all go through one browser queue, the Upload Manager.

## 2. Problems

1. **Errors die in the browser.** `createSSEResponse` turns every failure into `sendEvent("error")` and never logs it (L55-67). A defect (an `Effect.die` or a thrown error) skips `catchAll`, rejects, and is swallowed by `.catch(() => {})` (L75): the client gets a closed stream with no message, and the server logs nothing.
   - **Today's case:** an Overlay render failure showed only as a toast. Which path it came from is not yet known; today's `start-*.log` files have no Overlay error line, and no Video log has an `export-stage-failed` entry.
     - **If it was a vertical Shorts render (#8):** `RenderVerticalError` carries the renderer's stderr straight to the SSE event, and nothing reaches `.data/logs`.
     - **If it was a normal export (#6):** the cause is logged, but the toast shows only the generic `ExportError("Failed to composite Overlays…")`. The cause is in the Video's own log, which nobody opens from a toast.
2. **Closing the tab is cancelling the job.** Navigating away, a reload or a crashed tab interrupts a 20-minute Publish halfway. "Away from keyboard" means "leave the browser open" (ADR 0024).
3. **A server restart strands state.** `pnpm dev` restarts on every server edit.
   - A Publish leaves a Pending Version that only a human can reconcile.
   - Clips stay stuck in `transcribing` forever.
   - A SIGKILL orphans ffmpeg (`S/ffmpeg-child-registry.ts` covers only clean exits).
4. **Retry policy is split across two places.** The client retries 3 times by re-running the whole SSE request. The server retries again inside: `recurs(2)` export, `recurs(1)` Dropbox, `MAX_RETRIES` AI Hero. One failure can therefore become up to 9 attempts, and `terminal` flags decide which of them apply.
5. **The Upload Manager is the one reducer the docs say not to copy.** It is a plain `useReducer` with setter events (`UPDATE_PROGRESS`, `UPDATE_EXPORT_STAGE`), and `planUploadReactions` diffs snapshots to decide restarts (`docs/FRONTEND_STATE.md`). It is about 9.6k lines, tests included.
6. **There is no record of what ran.** After the fact, nothing says which jobs ran, how long they took, or why they failed. ETA history is in localStorage, so it is per browser.
7. **Agents can't start background work.** `cvm course publish` runs in-process. No agent can start an export or a render without a browser.
8. **There is no concurrency control across tabs.** Two tabs can export the same Video at once. Only Publish holds a semaphore.

## 3. Proposed shape

```
browser ──(enqueue: POST action)──► app server ──INSERT job──► Postgres  job, job_event
   ▲                                    │                         ▲
   │  EventSource /api/jobs/events      │ proxies the stream      │ claim / heartbeat / events
   └────────────────────────────────────┴──── Unix socket ──► SIDECAR (apps/local/sidecar)
                                                               worker loop · lanes · handlers
                                                               ffmpeg · Remotion · Dropbox · YouTube · AI
```

### 3.1 The durable job table: in Postgres, the same database as the data

- **Tables:** `job` and `job_event` in `packages/core/db/schema.ts`, added by an additive migration (ADRs 0025 and 0026). All SQL stays in `packages/core`, behind a `db-job` service.
  - `job`: `id`, `kind`, `params jsonb`, `status` (`queued | running | succeeded | failed | interrupted | cancelled`), `lane`, `depends_on`, `attempt`, `max_attempts`, `lease_until`, `progress jsonb`, `error jsonb` (the full cause from `formatFailureCause`, not a summary), `subject_type` / `subject_id` (Video / Course / CourseVersion), and timestamps.
  - `job_event`: append-only `id bigserial`, `job_id`, `type`, `data`, `at`. It is the event log the UI replays from (`Last-Event-ID`).
- **Why this database:** apps/local already runs on production PlanetScale.
  - A verify-cvm clone gets its own empty job table for free.
  - #1868's guard already refuses a worktree writing to production, so a stray worktree sidecar cannot claim Matt's jobs.
  - Jobs join to the rows they work on. The `cvm` CLI can enqueue and read jobs over the one HTTP transport.
  - The alternative, SQLite in `.data/`, isolates per checkout but splits the domain across two databases. Rejected.
- **What the pooler allows:** it runs in transaction mode, so `LISTEN/NOTIFY` and session advisory locks are out.
  - **Claim** with one statement: `UPDATE job SET status='running', lease_until=now()+30s … WHERE id = (SELECT id … WHERE status='queued' AND lane=$1 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.
  - **Heartbeat** the lease every 10 s.
  - **Find work** by polling every 1 s per lane. That costs nothing at one author, and an enqueue nudges the sidecar over its socket so a new job starts at once.
- **One sidecar per database:** a single-row `sidecar_lease` holds a 15 s lease plus the checkout path and git SHA. A second sidecar on the same DB exits and names the holder.

### 3.2 The worker loop

`apps/local/sidecar/run-sidecar.ts` is the entry point and one Effect runtime boundary. It is filesystem-bound, so it lives in `apps/local`, never in `packages/core`.

- **Lanes, each with its own concurrency:**
  - `render` (ffmpeg, Remotion, Whisper): 1
  - `network` (YouTube, Buffer, Dropbox, AI Hero): 3
  - `ai` (Autofill): 1 job, with 6 Videos inside it as today
  - `publish`: 1, which replaces the global mutation semaphore
- **A handler registry:** `kind → { lane, paramsSchema, idempotent, run(params, ctx) }`. `ctx.emit(event)` writes a `job_event` row. Handlers reuse today's services unchanged (`CoursePublishService.exportVideo`, `RenderVerticalVideoService`, …). Only their driver moves.
- **Retry is decided once, on the server, from data:**
  - `attempt < max_attempts` and a retryable error tag → back to `queued` with backoff.
  - Otherwise → `failed`.
  - Services keep only their own narrow HTTP retries (the Dropbox HTTP `recurs(5)`). The client never retries; it can only press "Retry", which enqueues `attempt + 1`.
- **On startup, recover:** any `running` job whose lease has expired becomes `queued` if its kind is idempotent (export, render, transcription: content-addressed, safe to run again) or `interrupted` if it is not (posting, Publish).
  - A Publish left `interrupted` runs `pending-recovery` automatically and records Promote or Discard as events.
  - The same sweep re-queues clips stuck in `transcribing`.
- **Dependencies:** `depends_on` replaces the client-side `dependsOn`. A failed parent fails its children in the same transaction.
- **Shutdown:** SIGTERM stops claiming, interrupts running fibers (the ffmpeg registry kills children), and marks them `interrupted`. The sidecar also sweeps orphaned ffmpeg PIDs on start.

### 3.3 Job events → the front end

- **Stream:** `GET /api/jobs/events` is one SSE stream per tab, proxied by the app server from the sidecar socket.
  - It starts with a snapshot of active and recent jobs, then streams `job_event`s. On reconnect it resumes from `Last-Event-ID`.
  - It is a read-only subscription: **closing it cancels nothing.**
- **Reducer:** a new `features/jobs/jobs-reducer.ts` (`namespace jobsReducer`, built on `useEffectReducer`) replaces `upload-reducer.ts`.
  - **Events are facts from the sidecar:** `job-snapshot-received`, `job-queued`, `job-started`, `job-progressed`, `job-stage-entered`, `job-succeeded`, `job-failed`, `job-interrupted`. Gestures: `press-retry`, `press-cancel`, `press-dismiss`.
  - **Effects:** `enqueue-job`, `retry-job`, `cancel-job`, `show-toast`.
  - Toasts become reducer decisions on `job-failed`. That retires `planUploadReactions` and the setter events.
- **Bridge:** one `useEffect` holds the EventSource and only dispatches.
- **Selectors:** ETA and progress selectors carry over (`upload-selectors.ts`, `upload-eta*.ts`). Stage durations come from `job_event` timestamps instead of localStorage.
- **Failed jobs:** the row shows the summary and links to the job's log (§3.4).

### 3.4 Structured logs per job

- **Logger:** the sidecar installs an Effect JSON logger (`Logger.replace`). It annotates every line with `jobId`, `kind`, `attempt` and `subject`.
- **Where lines go:**
  - stdout, which is teed by `run-with-log.sh` into `.data/logs/dev-*.log` as today;
  - `.data/logs/jobs/<jobId>.jsonl`, which holds every log line, every stage, and child-process stderr (the ffmpeg logger and the overlay renderer's stderr);
  - `job.error`, which keeps the full cause chain.
- **Rule: no failure leaves the sidecar without a log line.** This is enforced in the worker loop's single `catchAllCause`, not per handler. Defects included.
- **For agents:** `cvm job show <id>` and `cvm job log <id>` read them. That makes "what failed overnight?" answerable without Matt pasting a toast.

### 3.5 Starting it, and the main-checkout rules

- **Scripts:** add `dev:sidecar` (`tsx watch sidecar/run-sidecar.ts`) and `start:sidecar` to `apps/local/package.json`. The existing `"/dev:/"` and `"/start:/"` patterns then start it next to the app and the forwarder, and `run-with-log.sh` logs it with no change.
- **Socket:** `<checkout>/.data/sidecar.sock`, a Unix socket rather than a TCP port, so it never touches the 5170-5199 or 5200-5299 bands. `CVM_SIDECAR_SOCKET` overrides it.
- **Main checkout:** runs against production, as the app does.
- **Worktree:** the #1868 guard already refuses a remote DB. A worktree sidecar runs only against a local or verify-clone DB. Unlike the live desk (#1867), it does not need to be main-only, because the database and the socket keep it isolated.
- **If the sidecar is down:** enqueue still succeeds (it is a row), and the UI shows a "sidecar not running" banner from the proxy's health check. Jobs start when the sidecar comes up. Nothing is lost.
- **Versioning:** the `sidecar_lease` row carries the git SHA. The app warns when its build and the sidecar's differ. `tsx watch` restarts the sidecar on edit, and lease recovery (§3.2) makes that safe.

### 3.6 verify-cvm gets its own sidecar

- **Launch:** `verify.sh launch` starts the sidecar beside the run's server.
  - It uses the same `DATABASE_URL` (the run's `cvm_verify_<id>` clone).
  - It sets `CVM_SIDECAR_SOCKET=<run dir>/sidecar.sock` and points the job logs at `<run dir>/logs/jobs/`.
  - It reuses the scratch file directories and the dud credentials the run already has.
- **Isolation:** the sidecar on a clone can only ever see that clone's job table. Its lease row is its own.
- **Production:** `launch --production` is read-only, so the sidecar refuses to start: it cannot write a lease. Enqueue fails with a 500, as every write does there.
- **`doctor`** checks three things: the sidecar pid is alive, its socket answers, and its lease names this run's clone.
- **`cleanup`** stops the sidecar before it drops the clone.
- **Write Ledger:** `job` and `job_event` rows are excluded from the Ledger triggers, or grouped under one "jobs" line, so they don't drown the writes that are being verified.

### 3.7 Guards: the pit of success

1. **`scripts/check-background-jobs.ts`** (oxc-parser, like `check-effect-guards.ts`) uses a shrink-only allowlist, `scripts/background-jobs-allowlist.json`. The allowlist starts at today's count and must be 0 when the migration is done. It flags:
   - `createSSEResponse(` or `text/event-stream` in `routes/`, except `api.jobs.events.ts` and the interactive AI streams (#11, #14), which are listed once with a reason;
   - `consumeSSEStream`, `new EventSource`, or a `while (!unmounted)` loop in `app/`, outside `features/jobs/`;
   - `child_process`, `Command.make`, `ffmpeg-run` or `overlay-renderer-bin` imported from any module reachable from `routes/` (checked with dependency-cruiser in `lint:boundaries`). Spawning is a sidecar handler's job.
2. **A runtime guard:** `FfmpegRun`, `OverlayContentRenderer` and the external posting services require a `SidecarContext` tag that only the sidecar layer provides.
   - The app server's `layerLive` does not provide it, so a route that reaches a render fails to build. This is the same trick #1868 uses with `GitWorktreeProbe`.
   - The CLI and tests provide a fake or a test layer.
3. **One way in:** `enqueueJob(kind, params)` is the only API, and `kind` is a closed union checked against the handler registry. A new job type is a new handler file plus one registry line. There is no other path.
4. **The front-end guard** (`check-frontend-state.ts`) gains a rule: no `AbortController` map, retry counter or job queue in a reducer outside `features/jobs/`.
5. **Docs:** a `CODING_STANDARDS.md` section, "Background work runs in the sidecar", plus a new ADR (0032) that supersedes ADR 0024's "deferred" note. Add **Job**, **Sidecar**, **Lane** and **Job Event** to `GLOSSARY.md`.

## 4. Migration order

Each batch is one PR. Each can be merged on its own, and each leaves the app working.

| Batch | What                                                                                                                                                                                                                                                                                                                                  | Done when                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 0     | **Logging fix, no sidecar.** `createSSEResponse` logs every failure and defect with `Effect.logError(cause)` and sends defects to the client too. `RenderVerticalError` goes into the Video's log through `recordStageFailure`. The export toast shows the cause's first line, not the generic `ExportError`.                         | Today's overlay failure would have been in `.data/logs`. Ships this week, whatever else is decided.      |
| 1 ✅  | **Done.** **The skeleton.** `job`, `job_event` and `sidecar_lease` migration; `db-job` service; `apps/local/sidecar/` with lease, claim, heartbeat, recovery, JSON logger and socket; `dev:sidecar` / `start:sidecar`; verify-cvm launch, doctor and cleanup; one `noop` kind; `check-background-jobs.ts` landed with today's counts. | `pnpm dev` starts the sidecar; a test job runs and is logged; a verify run has its own. No UI change.    |
| 2 ✅  | **Done.** **Upload Manager front end on job events.** `/api/jobs/events` proxy; `jobs-reducer.ts` and its bridge; the Global Upload Progress renders server jobs next to the old ones. First kind: **Video export (#6)**, whose SSE route is deleted.                                                                                 | Close the tab mid-export, reopen it: the export is still running and finishes. The allowlist drops by 1. |
| 3     | Batch export (#7) as N `export` jobs with a parent, plus the vertical Shorts render (#8).                                                                                                                                                                                                                                             | Kill the sidecar mid-render; it re-queues on restart.                                                    |
| 4     | Posting: YouTube upload, Shorts, Buffer, AI Hero, Skills Changelog (#1-#5). `depends_on` moves to the server. Non-idempotent: an interrupted post asks before running again.                                                                                                                                                          | Chain "upload → AI Hero post" survives a reload.                                                         |
| 5 ✅  | **Done.** Course Autofill (#10), in the default lane: no `ai` lane (section 7.8).                                                                                                                                                                                                                                                     | —                                                                                                        |
| 6     | **Publish (#9).** The `publish` lane replaces the semaphore. Recovery runs Promote/Discard automatically on startup. `cvm course publish` enqueues and tails events (a `--wait` flag).                                                                                                                                                | A restart mid-Publish recovers without a human.                                                          |
| 7     | Transcription (#12): the sweeper picks up `queued` clips, so the browser no longer drives them.                                                                                                                                                                                                                                       | No clip stays stuck in `transcribing` after a restart.                                                   |
| 8     | **Delete** `upload-reducer.ts`, the `sse-*-client.ts` files, `planUploadReactions` and the localStorage ETA history. Allowlist at 0 except the listed interactive streams. Write ADR 0032.                                                                                                                                            | `check` is green with the guard at 0.                                                                    |

Later, and optional: OBS ingestion (#13) and a `cvm job` noun.

Section 3.2's lane numbers (render 1, network 3, ai 1, publish 1) and its
recovery rule (idempotent kinds re-queue, posting and Publish wait for a click,
a Publish reconciles itself) are superseded by Matt's decisions 2 and 3: the
sidecar copies today's limits and today's retries instead. See section 7.

## 5. Open questions for Matt

1. **Which DB holds the job table?** _Recommend:_ the same Postgres (production for the main checkout, the clone for verify runs). The alternative is a per-checkout SQLite file. It isolates trivially, but jobs can't join to Videos and `cvm` can't see them.
2. **What happens to a job the sidecar was running when it died?** _Recommend:_ rerun idempotent kinds automatically (export, render, transcription). Mark posting and Publish `interrupted` and wait for one click. A Publish additionally reconciles its Pending Version automatically.
3. **Should `cvm course publish` (and agents generally) enqueue instead of running in-process?** _Recommend:_ yes, with `--wait` to tail events. Then an agent can start exports and Publishes, and every run is logged in one place. The cost: the sidecar must be running on the author's machine.
4. **Lane concurrency.** _Recommend:_ render 1, network 3, ai 1 (6 Videos inside), publish 1. Should exports run 2 at a time on your machine?
5. **Do the interactive AI streams stay in the browser?** These are the Article Writer, completions and the single-Video chapter Autofill modal. _Recommend:_ yes. They are conversations, not background work, so they are exempt in the guard by name.
6. **Should OBS ingestion move to the sidecar?** It would become a recording-dir watcher. _Recommend:_ not in this migration. It is tied to a live recording session in the editor. Batch 0 should still stop it swallowing errors.

## 6. Matt's decisions (2026-10-08)

1. **Job table:** same Postgres as the data (production for the main checkout, the verify clone for runs).
2. **Rerun after a crash / retries:** copy the existing logic exactly. Find what the upload manager / export clients do today (retry counts, which kinds retry, what happens to an interrupted job) and reproduce that behaviour in the sidecar. Don't invent a new policy.
3. **Concurrency:** copy the existing concurrency limits already in the codebase (upload manager queue, Publish semaphore, etc.). Don't invent new lane numbers.
4. Questions 3, 5 and 6 use the recommendations above (enqueue with `--wait`; interactive AI streams stay in the browser; OBS ingest later).
5. **Posting never runs twice on its own** (decided before batch 4). Matt: "I definitely don't want reruns to happen on their own. Posting twice would be disastrous." So every posting Job kind — YouTube upload, YouTube Shorts post, Buffer post, AI Hero post and Skills Changelog post (#1-#5) — gets **exactly 1 attempt**:
   - No automatic retry when an attempt fails.
   - No re-queue after a deliberate stop (a signal: `tsx watch` restarting, Ctrl-C, verify-cvm's cleanup) or a sidecar crash. Section 7.5's "a stop on purpose puts the Job back at the same attempt" does not apply to a posting kind.
   - A post that is cut off goes to a terminal state, **"interrupted — check before retrying"**, with a manual **Retry**. Where the service allows it (YouTube, Buffer, AI Hero), the sidecar checks whether the post went out and says so on the row.
   - Batch 4 adds a guard test asserting all of this for every posting kind, so a new one cannot slip back to 3 attempts.

   **This overrides decision 2 ("copy the existing logic exactly") for posting only.** Today the browser retries a failed post up to 3 times (section 7.1) and re-runs one cut off by a server death (section 7.2); the sidecar does neither. Every other kind still copies today's behaviour.

## 7. What the sidecar copies (findings, 2026-10-08)

Matt's decisions 2 and 3 say: reproduce today's behaviour, invent nothing. This
is today's behaviour, read from the code. Paths are under `apps/local/app/`
unless stated. Batch 1 encodes all of it as data, so later batches only add
handlers: lanes in `apps/local/sidecar/lanes.ts`, attempts per kind in
`apps/local/sidecar/retry-policy.ts`, and the retry rule itself, once, in
`packages/core/services/db-job-operations.server.ts`.

### 7.1 Retries

| Today                                                                                                                                                                                             | Where                                                                                                     | In the sidecar                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A failed job (`UPLOAD_ERROR`) spends an attempt; while fewer than **3** have run and it is not `terminal`, it goes to `retrying`                                                                  | `UM/upload-reducer.ts:567`                                                                                | `max_attempts = 3`; `attempt < max_attempts` → back to `queued` as `attempt + 1`                                                                                                     |
| The retry runs **at once**, with the params it started with: no delay, no backoff, and every error counts as retryable                                                                            | `UM/upload-transitions.ts:51`, `UM/upload-context.tsx:620`                                                | A retried Job goes straight back to `queued` and the settle nudges the lanes, so it is claimed at once. No backoff column                                                            |
| A **Publish** and an **Autofill** report every failure as `UPLOAD_FATAL_ERROR`, which sets `terminal`: **1 attempt**. So do the per-Video rows each fans out into                                 | `UM/upload-type-registry.ts:577-634`, `UM/upload-type-autofill.ts:88-108`, `UM/upload-reducer.ts:533`     | `max_attempts = 1` for `publish` and `autofill`                                                                                                                                      |
| Export, YouTube upload, Shorts, Buffer, AI Hero, Skills Changelog and vertical render report `UPLOAD_ERROR`: **3 attempts**                                                                       | `UM/upload-type-registry.ts:118, 186, 250, 313, 381, 459, 690`                                            | `max_attempts = 3` (`UPLOAD_MANAGER_POLICIES`)                                                                                                                                       |
| A Batch export child that fails is retried by the client as a **standalone** export (its `initiate` ignores params), after the batch already retried it twice on the server: up to 3 + 2 = 5 runs | `UM/upload-context.tsx:431-500`, `UM/upload-type-registry.ts:95`, `S/course-publish-export-events.ts:160` | Batch 3: the batch Job hands a failed Video on as an `export` Job with 2 attempts, at once (section 7.6). Still 3 + 2 = 5                                                            |
| When a job fails for good, every job **waiting on it** fails with `Dependency "<title>" failed`                                                                                                   | `UM/upload-reducer.ts:554` and `:597`                                                                     | Same message, same transaction (`failDependents`). One difference: the client failed only direct dependents, leaving a grandchild waiting forever; the sidecar fails the whole chain |
| A job waiting on another starts when that one succeeds                                                                                                                                            | `UM/upload-context.tsx:204`, `UM/upload-transitions.ts:61-69`, `UM/upload-reducer.ts:521-523`             | `claimNextJob` takes a Job only once the Job it depends on has `succeeded`                                                                                                           |

The narrow retries **inside** a service stay where they are, untouched: an
export inside a Publish or Batch export `recurs(2)` (`S/course-publish-export-events.ts:160`);
the Dropbox commit `recurs(1)` (`S/course-publish-service.ts:413`); Dropbox
HTTP `recurs(5)`, exponential from 1 s, on a 429 or 5xx (`S/dropbox-http-client.ts:36-39`);
an AI Hero part upload 5 times (`S/ai-hero-upload-service.ts:12`, `:139`);
Autofill `recurs(3)` per Video, exponential from 500 ms, jittered
(`S/autofill-service.ts:57-62`). Problem 4 in section 2 (retries multiplying
across the two layers) therefore stays exactly as it is. Changing it is a new
policy, and Matt's call.

### 7.2 A job that is cut off

| Today                                                                                                                                                                                                                      | Where                                                                         | In the sidecar                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tab closed or reloaded**: the provider aborts every controller on unmount; the server's `cancel()` interrupts the fiber. The job dies, and its row lived only in React memory, so nothing re-runs it                     | `UM/upload-context.tsx:637-643`, `lib/create-sse-response.server.ts:82-86`    | This is the failure the migration exists to remove, not a policy to copy: a Job is a row, and closing a tab no longer touches it                                                                                                                                |
| **Server dies mid-job**: the stream's reader rejects (not an `AbortError`), so the client calls `onError` → `UPLOAD_ERROR`: the job spends an attempt and is retried at once (3-attempt kinds), or fails (1-attempt kinds) | `UM/consume-sse-stream.ts:19-28`                                              | A run the sidecar lost — it was stopped (SIGTERM), or died and its 30 s Job lease ran out — is settled as a failed attempt by the same rule: re-queued while attempts remain, `interrupted` on the last. `recoverExpiredJobs` does this on start and every 15 s |
| A stream that closes cleanly without a final event leaves the row at its last stage, forever                                                                                                                               | `UM/consume-sse-stream.ts:58`                                                 | No equivalent: every handler exit is settled                                                                                                                                                                                                                    |
| **A Publish cut off** leaves its Pending Version; the publish page classifies it from the Dropbox receipt and offers Promote or Discard **by hand**                                                                        | `S/pending-recovery.server.ts:12`, `R/_app.courses.$courseId.publish.tsx:123` | Batch 6 keeps that by hand: an interrupted Publish (1 attempt) is `interrupted`, and the page offers the same choice. Section 3.2's automatic Promote/Discard would be a new policy                                                                             |
| Clips stuck in `queued`/`transcribing`: nothing sweeps them                                                                                                                                                                | `features/video-editor/edit-effect-handlers.ts`                               | Unchanged until batch 7                                                                                                                                                                                                                                         |

**Flag for Matt before batch 4.** Copying this exactly means a YouTube upload,
Buffer post or AI Hero post that is cut off mid-run is run again automatically
(it is today too, when the server dies mid-stream), so a post that had in fact
landed can be posted twice. Section 3.2's "posting waits for a click" would stop
that, but it is a change of policy, so it is not built. **Decided:** Matt chose
the change of policy for posting — section 6, decision 5: 1 attempt, no
re-queue, "interrupted — check before retrying".

### 7.3 Concurrency

| Today                                                                                                                                                                 | Where                                                                                   | In the sidecar                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| The Upload Manager has **no queue limit**: every job starts the moment it is dispatched (only `dependsOn` holds one back), so ten exports are ten concurrent requests | `UM/upload-context.tsx:204` (and every `start*` callback), `:99` `initiateFromRegistry` | Lane `default`: unbounded                                                                                                  |
| Every **Publish** holds `courseVersionMutationSemaphore`, one permit, for its whole run                                                                               | `S/course-publish-service.ts:87`, `:486`                                                | Lane `publish`: 1                                                                                                          |
| ffmpeg: 6 GPU and 12 CPU permits per process                                                                                                                          | `S/ffmpeg-commands.ts:25-26`                                                            | Stays in the service. The sidecar builds each layer once, as the app server does, so the limits are process-wide there too |
| `MAX_CONCURRENT_EXPORTS` = 6 inside a Publish or Batch export                                                                                                         | `S/course-publish-export-events.ts:79`, `:185`                                          | Stays in the service                                                                                                       |
| Autofill: 6 Videos at a time                                                                                                                                          | `S/autofill-service.ts:54`, `:308`                                                      | Stays in the service                                                                                                       |
| Dropbox upload pool: `DROPBOX_UPLOAD_CONCURRENCY`, default 4                                                                                                          | `S/dropbox-upload-config.ts:17`                                                         | Stays in the service                                                                                                       |
| AI Hero: 4 parts at a time                                                                                                                                            | `S/ai-hero-upload-service.ts:13`                                                        | Stays in the service                                                                                                       |
| Transcription: 20 permits                                                                                                                                             | `S/video-processing-service.ts:19`                                                      | Stays in the service                                                                                                       |

### 7.4 What batch 1 built, and what it left

Built: the `job`, `job_event` and `sidecar_lease` tables (migration
`0029_background_jobs`, additive); `JobOperationsService`
(`packages/core/services/db-job-operations.server.ts`: enqueue, claim with
`FOR UPDATE SKIP LOCKED`, heartbeat, settle by the retry rule, recovery, the
lease); `apps/local/sidecar/` (entry point, lanes, retry policy, kind registry,
JSON logger writing every Job's lines to `.data/logs/jobs/<job id>.jsonl`, the
Unix socket with `/health`, `/nudge`, `/jobs`, `/jobs/<id>`); the `noop` kind;
`dev:sidecar` / `start:sidecar`, so `pnpm dev` and `pnpm start` run it;
verify-cvm launching, doctoring and cleaning up a sidecar per run, with its
writes on their own line of the Write Ledger; `scripts/check-background-jobs.ts`
with today's counts (11 streaming routes, 14 browser drivers).

The sidecar respects the existing guards: it builds its client through
`DrizzleService` and refuses, before connecting, wherever the connection guard
would (a worktree with a writable remote database); it refuses a read-only
connection; it never touches the live desk's ports (it has no port at all); and
every Job log path goes through `assertUnder`. Every exit is 0, because pnpm
stops the whole `pnpm dev` when one script fails: a sidecar that cannot run
says why and gets out of the app's way.

Left for later batches, on purpose:

- The `/api/jobs/events` proxy, the reducer and any UI (batch 2).
- Section 3.7's third guard (spawning reachable from `routes/`, via
  dependency-cruiser) and the `SidecarContext` runtime guard: they mean
  something only once a real handler spawns (batches 2-3).
- A cancel verb (`cancelled` exists in the status check, nothing sets it yet).
- `tsx watch` restarts the sidecar on every edit, and a restart spends an
  attempt of each running Job. Harmless for `noop`; worth a look in batch 2,
  when a 20-minute export could be cut off by a save.
- verify-cvm puts a run's socket in `$XDG_RUNTIME_DIR` (else `/tmp`), named by
  the run id: a run directory's path is longer than a Unix socket allows
  (107 bytes).

### 7.5 What batch 2 built, and what it decided

Built: **Video export (#6) is the first real kind** (`apps/local/sidecar/kinds/export.ts`,
`CoursePublishService.exportVideo` unchanged, 3 attempts, default lane). Its SSE
route (`api.videos.$videoId.export-sse.ts`) and browser client
(`sse-export-client.ts`) are deleted, and both allowlist entries with them. The
sidecar builds the app's own `layerLive`, so handlers reach every service.

- **Job Events to the browser.** The sidecar's socket serves `GET /events`: a
  snapshot (unfinished Jobs, failed and interrupted ones until the author
  dismisses them, and succeeded ones from the last 24 hours not dismissed,
  each with its events — see "Dismissal is stored" below), or a replay after `Last-Event-ID`, then every new event.
  One poller reads `job_event` for all subscribers (no LISTEN/NOTIFY on the
  pooler), woken by the sidecar's own writes and by `/nudge`, re-reading a
  window of ids for late commits (`sidecar/job-event-feed.ts`). The app's
  `GET /api/jobs/events` passes it through untouched, and answers
  `sidecar-unavailable` when nothing listens on the socket. The wire format is
  `features/jobs/job-wire.ts`, imported by both ends. `scripts/check-background-jobs.ts`
  exempts that one route by name.
- **Enqueue.** `POST /api/jobs` writes the row and nudges the sidecar; it
  succeeds with the sidecar down. The browser picks the Job's id, so
  "export, then post" still works: an upload's `dependsOn` is the export
  Job's id, and the Upload Manager hears it settle (`server-job-succeeded` /
  `server-job-failed`, the same `Dependency "<title>" failed` message).
- **The reducer.** `features/jobs/jobs-reducer.ts` (facts: `job-requested`,
  `job-queued`, `job-started`, `job-stage-entered`, `job-progressed`,
  `job-retrying`, `job-requeued`, `job-succeeded`, `job-failed`,
  `job-interrupted`, `job-snapshot-received`, `sidecar-unavailable`,
  `press-dismiss`, `idle-timeout-elapsed`; effects: `enqueue-job`, the toasts,
  `report-job-settled`), its bridge and runner in `use-jobs.ts`. It lives
  inside `UploadProvider`, and the Global Upload Progress draws each export
  Job as an Upload Manager row (`jobs-selectors.ts`: same stages, bands and
  labels), next to the browser's own rows. A failed Job's toast and row link
  to its log (`/api/jobs/<id>/log`, read from the sidecar's socket).
- **A Batch export child's retry** (section 7.1's open row): the browser used
  to retry a failed child as a standalone export through the deleted route.
  It now hands it to the sidecar as an `export` Job with the attempts the row
  had left (`attemptsSpent`), so the run count stays 3 + 2 = 5, as before.
  Batch 3 moved this hand-off into the sidecar (section 7.6).

**`tsx watch` restarts.** A stop on purpose — a signal: `tsx watch` restarting
after an edit, Ctrl-C, verify-cvm's cleanup — no longer spends an attempt:
each running Job goes back to `queued` at the SAME attempt (`returnJobToQueue`,
a `requeued` event) and the next sidecar runs it. A sidecar that dies (SIGKILL,
a crash, a lost database) still has its Jobs settled by recovery as failed
attempts, as section 7.2 copies. This does not change the copied rule: the
browser never saw a dev edit cut off an export (Vite reloads modules without
dropping the request), so there is no old behaviour for a deliberate restart
to copy, and "the server died mid-stream" still costs an attempt. The ffmpeg
child registry's own SIGTERM handler, which SIGKILLs every child and re-raises
the signal, is switched off in the sidecar (`leaveSignalsToTheProcess`): it
killed the process before any Job was put back. The stop takes well under
tsx's 5 s grace (about 0.4 s in the verify run), and ffmpeg dies with its
fiber's scope; the exit backstop stays.

**The spawn guard (section 3.7, items 1's third bullet and 2) is not added.**
Every other spawning job — Batch export, Publish, the vertical render — still
runs in the app server until batches 3 and 6, through the same
`CoursePublishService` and `FfmpegRun`. A `SidecarContext` requirement on
those services would stop the app building, and a dependency-cruiser rule on
`routes/` would fail on those routes today. It belongs to the batch that moves
the last of them (6), or to batch 8.

Left out, on purpose:

- **ETA for a server Job.** Its row shows stage and percent, not time left;
  the ETA still reads the browser's own stage history. Stage durations from
  `job_event` timestamps (section 3.3) come with batch 8's clean-up.
- **Cancel.** Dismissing a Job's row hides it; the export carries on. There is
  still no cancel verb.
- **A stale row while the sidecar is down.** A stopping sidecar writes its
  `requeued` events as it closes the stream, so an open tab may still show the
  last stage until the sidecar is back and replays them. The row's dialog says
  the sidecar is not running.

### 7.6 What batch 3 built, and what it decided

**The vertical Shorts render (#8) is a kind** (`apps/local/sidecar/kinds/render-vertical.ts`):
`RenderVerticalVideoService.renderVerticalVideo` unchanged, 3 attempts, the
default lane (`UPLOAD_MANAGER_POLICIES["render-vertical"]`, copied). Each stage
(concatenating, transcribing, rendering the overlay, compositing) is a `stage`
Job Event, and the Global Upload Progress draws the Job as the
`render-vertical` row it drew before: same stages, same floors of the bar. Its
SSE route (`api.videos.$videoId.render-vertical-sse.ts`) and browser client
(`sse-render-vertical-client.ts`) are deleted, and both allowlist entries with
them. `startRenderVerticalUpload` enqueues the Job and returns its id, so the
Shorts posting dialog's "render, then post" still works: the YouTube Shorts and
Buffer posts wait on the Job's id, are released when it succeeds and fail with
`Dependency "<title>" failed` when it fails. Problem 1's case — a render's
failure that only ever reached a toast — is gone: the cause is in the Job's
log, behind the toast's **View log**. The stage reports go through
`sidecar/ordered-events.ts`, the export's ordered writer, now shared.

**The spawn guard, part of it (section 3.7, guard 2).** `SidecarContext`
(`app/services/sidecar-context.ts`) is a tag only the sidecar's layer provides.
`renderVerticalVideo` and `batchExport` ask for it, so a route that reaches a
vertical render or a Batch export does not compile (`makeAction` / `makeLoader` accept only `LayerLive`);
`sidecar-context.test.ts` pins that at the type level. Still outside it, because
the app server still runs them: `CoursePublishService.exportVideo` (a Publish
exports in-process until batch 6),
`FfmpegRun` and `OverlayContentRenderer` (Publish, and the editor's own
interactive ffmpeg calls: thumbnails, frames, transcription), and the posting
services (batch 4). Guard 1's third bullet (a dependency-cruiser rule on
`routes/`) waits for those too.

Left out, on purpose:

- The Upload Manager's `UPDATE_RENDER_VERTICAL_STAGE` action and the
  `render-vertical` entry type stay: the type is how a Job draws as a row, and
  the action has no caller left. Batch 8 deletes `upload-reducer.ts` whole.
- No success toast existed for a browser-driven render; the Job's generic one
  ("rendered as a vertical Short") is new, and the Shorts page now revalidates
  on it, as it did on the browser row's success.

**Batch export (#7) is a kind** (`apps/local/sidecar/kinds/batch-export.ts`):
`CoursePublishService.batchExport` unchanged — 6 Videos at a time
(`MAX_CONCURRENT_EXPORTS`), each tried 3 times inside the service
(`recurs(2)`). It is ONE Job, not N: the batch's concurrency and in-service
retries are the copied behaviour, and N `export` Jobs in the unbounded default
lane would have run every Video at once with 3 sidecar attempts each. The
Upload Manager still draws one export row per Video (`isBatchEntry`), from the
batch's own Job Events: `videos`, `video-stage`, `video-progress`,
`video-succeeded`, `video-failed`, `video-handed-off`. Each Video toasts as it
lands; the batch itself toasts only if it fails. Its SSE route
(`api.courseVersions.$versionId.batch-export-sse.ts`) and browser client
(`sse-batch-export-client.ts`) are deleted, and both allowlist entries with
them; the browser hand-off batch 2 added (`initiate: null` → `startJob`) is
gone with them.

What the browser did around the stream is copied in the handler:

| Today, in the browser                                                                                                       | In the sidecar                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Video's `error` event: its row went to `retrying` (`retryCount` 1) and was re-run at once as a standalone export          | The handler hands the Video on at once as its own `export` Job with `maxAttempts` 2 (`video-handed-off`), and the batch carries on. 3 + 2 = 5, as before      |
| The stream failed (`error` with no Video, or the reader rejected): every unfinished row errored and was re-run the same way | The batch failing (not a stop) hands every announced, unfinished Video on the same way, then fails with its cause                                             |
| The batch as a whole had no row, no attempt count and no retry                                                              | `batch-export`: 1 attempt, default lane (`retry-policy.ts`)                                                                                                   |
| The server dying mid-stream counted as the stream failing                                                                   | A lost run (recovery found the lease expired, or the sidecar lost it) is `interrupted`, and the kind's new `afterLostRun` hook hands its unfinished Videos on |

`afterLostRun` (`job-kind.ts`) is the one new piece of sidecar machinery: an
optional per-kind hook the sidecar calls after recovery settles a lost run, and
after it loses a Job's lease mid-run — never after a deliberate stop. The
hand-off reads the batch's own Job Events, so it never hands a Video on twice.

A deliberate stop (a signal) puts the batch back at the same attempt, as for
every kind (section 7.5). Its re-run skips every Video already exported
(`findShippingVideos`, content-addressed) and, through a new optional
`skipVideoIds` argument to `batchExport`, every Video an earlier run already
handed on — without it, the re-run exported a handed-on Video a second time
beside its own Job (found in the verify run).

Left out, on purpose:

- No parent row for the batch: the browser never drew one. A batch that fails
  before it announces its Videos (a missing Version) shows only its failure
  toast, with its log — where today it showed nothing at all.
- A Batch export's `title` ("Export all: <Course>") is new: a Job needs one for
  its log and its failure toast.

### 7.7 What batch 4 built (first PR: the posting rule, YouTube and Shorts)

**Decision 5 is enforced in four places**, so a post cannot run twice by
mistake:

1. **Types.** A posting kind is defined with `definePostingJobKind`
   (`sidecar/job-kind.ts`), which takes no lane or attempts: it always gets
   `POSTING_JOB_POLICY` (`maxAttempts: 1`, a literal type, and `posting:
true`). `defineJobKind` refuses `posting: true`. Both are pinned with
   `@ts-expect-error` in the guard test.
2. **The sidecar.** A deliberate stop never puts a posting Job back
   (`settle` skips `returnJobToQueue` for it); it ends `interrupted`. Settling
   and recovery pass `mayRetry: false` / `neverRetryKinds` for posting kinds,
   so even a row that claims 3 attempts is never retried on its own.
3. **The database rule.** `settleFailure` takes `mayRetry`; only `retryJob`
   (the author's **Retry**, `POST /api/jobs/<id>/retry`) runs a post again —
   the same row as `attempt + 1`, with `max_attempts` set to that attempt.
   Retry is refused for kinds that retry on their own, for unfinished Jobs,
   and when the Job's dependency did not succeed.
4. **The guard test** (`sidecar/posting-kinds.test.ts`): every posting type
   in `POSTING_KIND_NAMES` that is registered is a posting kind with 1
   attempt; the browser's list (`POSTING_JOB_KINDS`) matches; and, on a real
   sidecar over PGlite: a failing post runs once; a post cut off by a stop or
   by a crash ends `interrupted`, is never re-run, and is checked once; Retry
   runs it exactly once more; a failed dependency fails it unrun.

The browser retried a failed post up to 3 times (section 7.1). **That is
removed on purpose.**

**"Interrupted — check before retrying".** After recovery, the sidecar looks
for every interrupted post with no `post-check` Job Event yet and asks the
kind's `checkPosted`, read-only (30 s timeout; a failure says `unknown`).
YouTube and Shorts look for an upload with the post's title among the
channel's latest 50 since the run started (`findRecentUpload`). The row
shows the verdict, a link when found, View log, and Retry — which asks
"Post again?" first unless the check said it did not go out. Auth failures
and failed dependencies show no Retry. An interrupted post stays in a new
tab's snapshot until the author dismisses it, and is never hidden by the
idle timer.

**`depends_on` is on the server.** `POST /api/jobs` takes `dependsOn`. The
jobs reducer holds a post's enqueue until its export's enqueue has
succeeded (the column is a foreign key), and fails it locally with
`Dependency "<title>" failed` if that enqueue fails. A queued Job with a
dependency draws as "Waiting for export".

**Moved:** YouTube upload (`kinds/youtube.ts`) and YouTube Shorts post
(`kinds/youtube-shorts.ts`). Deleted: `api.videos.$videoId.upload.ts`,
`api.videos.$videoId.post-youtube-shorts.ts`, `sse-upload-client.ts`,
`sse-youtube-shorts-client.ts`, and their allowlist entries.
`uploadVideoToYouTube` and `setYouTubeThumbnail` now ask for
`SidecarContext`. `YOUTUBE_API_URL` and `GOOGLE_OAUTH_TOKEN_URL` override
Google's URLs; verify-cvm sets every posting base URL to the discard port
unless the caller exports a strict loopback URL.

No migration: `interrupted` already existed.

**Second PR: Buffer, AI Hero and Skills Changelog.** Each is a posting kind
(`kinds/buffer.ts`, `kinds/ai-hero.ts`, `kinds/skills-changelog.ts`), and the
guard test now requires all five posting types to be registered. Deleted:
`api.videos.$videoId.post-social.ts`, `post-ai-hero.ts`,
`post-skills-changelog.ts` and `sse-social-client.ts`, `sse-ai-hero-client.ts`,
`sse-skills-changelog-client.ts`. `bufferPostProgram`, `postToAiHero` and
`postSkillsChangelogToAiHero` ask for `SidecarContext`. `S3_ENDPOINT` points the
object store at a path-style stand-in.

What each check can say:

| Kind             | How it looks                                                     | Can say                                                                                 |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| YouTube, Shorts  | the channel's latest 50 uploads, by title, since the run started | posted (with link) / not posted                                                         |
| Buffer           | the `video_post` row this run wrote                              | posted (Buffer gave an id) / not posted (no row) / unknown (cut off mid-upload or post) |
| AI Hero          | `GET /api/posts?slugOrId=<slug>`                                 | a post with that slug exists (with state) / not posted; unknown with no slug            |
| Skills Changelog | nothing: AI Hero picks the slug                                  | always unknown, says where to look                                                      |

**A dead Buffer key** (`BufferAuthError`, #1884) fails the Job before any
upload, after one pre-flight request; the row and toast carry the fix
(`BUFFER_AUTH_ERROR_MESSAGE`) and no Retry. Fix the key, then post again.

Left for later: the spawn guard's dependency-cruiser rule and
`FfmpegRun` / `OverlayContentRenderer` behind `SidecarContext` wait for
Publish (batch 6); the Upload Manager's `server-job-succeeded` /
`server-job-failed` actions and the posting entries' browser config go with
`upload-reducer.ts` in batch 8.

### 7.8 What batch 5 built (Course Autofill)

**Course Autofill (#10) is a kind** (`apps/local/sidecar/kinds/autofill.ts`):
`AutofillService.autofillCourseVersion` unchanged — 6 Videos at a time, a
Video's two fields in one transaction, a rate limit backed off `recurs(3)`
inside the service. 1 attempt (`UPLOAD_MANAGER_POLICIES.autofill`, copied: the
browser reported every Autofill failure as `UPLOAD_FATAL_ERROR`).
`autofillCourseVersion` now asks for `SidecarContext`. Deleted:
`api.courses.$courseId.autofill-sse.ts`, `sse-autofill-client.ts`,
`upload-type-autofill.ts` (its entry config moved into the registry with
`initiate: null`) and both allowlist entries.

**Default lane, not `ai`.** Section 3.2's `ai` lane (1 at a time) is one of
the lane numbers section 4's note supersedes: decision 3 copies today's
limits, and nothing held a second Autofill back in the browser. The 6 Videos
at a time stay in the service. `lanes.ts` has no `ai` lane.

What the browser did around the stream is copied:

| Today, in the browser                                                                                | In the sidecar                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A parent row ("Autofill <Course>", selecting → writing) and one child row per **Autofill Candidate** | The same rows, drawn from the Job's `stage`, `videos`, `video-succeeded` and `video-failed` events — the Batch export's per-Video events, so the jobs reducer folds them with no new action (`jobs-selectors.ts`) |
| A Video that fails: its row errors and toasts by name; the run carries on                            | `video-failed`, a warning in the Job's log, and the same toast, now with **View log**                                                                                                                             |
| The run settles: "<title> finished", **Back to Publish**                                             | `succeeded` (even when Videos failed, as before), the same toast                                                                                                                                                  |
| The stream fails (Version not a Draft, or gone): every unfinished row errors                         | The Job fails (`AutofillRunError`, the route's words), toasts once with **View log**; its unfinished Videos draw as failed                                                                                        |
| The publish page held its button on the run it started (component state)                             | It holds it on this Course's newest live Autofill Job, so a reopened tab still says "Autofilling…"                                                                                                                |

A deliberate stop puts the Job back (section 7.5); its re-run selects again,
and a Video the first run filled is no longer a candidate. A lost run is
`interrupted` (1 attempt), as a dropped stream was.

**verify-cvm:** `ANTHROPIC_BASE_URL` joins the loopback-or-discard rule, so
a clone's Autofill reaches only a local stub of the Messages API.

Left for later: `upload-reducer.ts`'s autofill entry type and
`UPDATE_AUTOFILL_STAGE` (the type is how the Job draws; batch 8 deletes the
reducer); an ETA for the Autofill rows (section 7.5's left-out ETA).

## Dismissal is stored

Dismissing a row used to hide it in that tab only, so every new tab's
snapshot brought it back. Now a settled Job's Dismiss (its row's X, or
"Clear finished" in the Upload Manager) is a `dismissed` **Job Event**
(`POST /api/jobs/dismiss`, `db-job-dismiss.server.ts`): no schema change,
since `job_event.type` is free text. Only a succeeded, failed or interrupted
Job can be dismissed; dismissing never cancels one that runs.

- **The snapshot** (`listRecentJobs`) leaves out every dismissed Job. A
  failed or interrupted Job — post or not — stays until it is dismissed,
  because it needs the author (and its Retry stays reachable). A succeeded
  one that nobody dismissed falls out after 24 hours.
- **Other tabs** hear the `dismissed` event on the live stream (the route
  nudges the sidecar, which wakes the feed) and drop the row
  (`job-dismissed`).
- **The idle timer** hides only succeeded Jobs, 5 s after everything has
  finished, and records that as a dismissal too. It never hides a failure.
- **This tab's own uploads** (the rows that never became Jobs) live only in
  the tab's memory: a reload never brings them back. "Clear finished" removes
  the settled ones with the Jobs.
