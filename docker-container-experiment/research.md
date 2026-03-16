# Docker Sandbox Research

## What we've built

A local Docker sandbox for running RALPH (autonomous Claude coding agent) without relying on GitHub Actions or any paid CI service. The sandbox is a long-lived, project-agnostic container that you send tasks to from any repo on your machine.

### Core primitives

- **Dockerfile** — Node 22, corepack, git, gh CLI, Claude Code. Runs as non-root `agent` user.
- **setup.sh** — Interactive setup: prompts for OAuth token + GH token, builds image, starts container.
- **run.sh** — Wrapper script that orchestrates the full cycle: sync repo via git bundle, run Claude, extract patches, apply locally.
- **cleanup.sh** — Tears everything down (container + image).
- **prompt.md** — Built-in prompt for RALPH's deterministic workflow.

### Key design decisions

- **Git bundles for sync** — Local repo state (including unpushed commits) is bundled and transferred into the container via `docker cp`. No GitHub round-trip needed for code transfer.
- **Patch extraction per iteration** — After each iteration, the RALPH commit is extracted via `git format-patch`, copied to the host, and applied with `git am`. If a later iteration fails, all previous work is preserved.
- **Re-sync after each patch** — After applying a patch locally, the sandbox is re-synced to match the new local state before the next iteration.
- **GitHub for issues only** — GitHub is used for reading/commenting on issues, not for code transfer. The code flow is fully local.
- **OAuth token auth** — Claude Code authenticates via `CLAUDE_CODE_OAUTH_TOKEN` passed at container start.

## Parallel execution (not yet built)

The current setup runs one RALPH at a time. But the primitives support running multiple RALPHs in parallel inside the same container.

### The problem

If two RALPHs independently pick from the same repo's issues, they may select the same task or make conflicting changes.

### Proposed solution: dispatcher pattern

Same pattern as `scripts/dispatch.sh` (which dispatches to GitHub Actions), but targeting parallel `docker exec` calls instead.

1. **Dispatcher** reads all open issues for a repo
2. **Dispatcher** asks Claude (Sonnet, cheap) to triage and partition tasks — which are AFK-able, which conflict, which are blocked
3. **Dispatcher** spawns parallel RALPH instances, each with:
   - A specific task assignment (prompt + issue numbers)
   - Its own namespaced repo clone inside the container (e.g., `/repos/course-video-manager-session-abc123`)
4. Each RALPH works independently, commits, and the wrapper extracts patches
5. Patches are applied sequentially to the local branch (or to separate local branches)

### Changes needed for parallelism

- **`run.sh` needs two modes:**
  - **Solo mode** (current) — RALPH picks from issues autonomously
  - **Dispatched mode** — receives a specific prompt and issue number(s), doesn't pick its own task
- **Namespaced repo paths** — `SANDBOX_REPO_DIR` needs a unique suffix per session to avoid collisions when two runs target the same repo
- **Unique temp file paths** — `/tmp/repo.bundle`, `/tmp/patches` are currently hardcoded; need unique paths per run
- **New `dispatch.sh`** — Orchestrator that reads issues, triages with Sonnet, and spawns parallel `run.sh` invocations
- **Patch ordering** — When multiple RALPHs finish, their patches need to be applied in a sensible order (or to separate branches)

### Open questions

- Should parallel RALPHs work on the same repo (requires conflict avoidance) or only different repos (simpler)?
- Should patches from parallel runs be applied to the same branch sequentially, or to separate branches for independent review?
- How to handle patch conflicts when two RALPHs touch overlapping files?
- Should the dispatcher be aware of in-progress RALPH sessions (like the GH Actions dispatcher tracks in-progress workflow runs)?
