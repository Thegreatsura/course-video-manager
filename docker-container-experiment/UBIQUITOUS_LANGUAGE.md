## Ubiquitous Language

| Term                  | Definition                                                                                                                              | Aliases to avoid                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **RALPH**             | The autonomous coding agent identity — the name under which Claude operates when working on tasks inside the sandbox                    | "the bot", "Claude worker", "the agent"                                                                            |
| **Sandbox**           | A long-lived Docker container that provides filesystem and process isolation for RALPH to execute arbitrary code safely                 | "Docker sandbox" (ambiguous with Claude's built-in `docker sandbox` feature), "container" (too generic), "microVM" |
| **Wrapper script**    | The host-side `run.sh` that orchestrates the full task cycle: git operations, context fetching, Claude invocation, and patch extraction | "dispatch script", "runner"                                                                                        |
| **Iteration**         | A single invocation of Claude inside the sandbox, producing at most one commit against one task                                         | "run", "cycle", "loop"                                                                                             |
| **Task**              | A single GitHub issue that RALPH selects and works on during an iteration                                                               | "job", "work item", "ticket"                                                                                       |
| **Patch**             | A `git format-patch` output file representing RALPH's commit, extracted from the sandbox and applied to the host repo                   | "diff", "changeset"                                                                                                |
| **Prompt**            | The built-in instruction set passed to Claude that defines the deterministic workflow: pick task, explore, implement, commit, comment   | "prompt.md", "RALPH.md" (decided against per-repo prompts)                                                         |
| **Completion signal** | The `<promise>COMPLETE</promise>` marker in Claude's output indicating all actionable tasks are finished                                | "done flag", "exit signal"                                                                                         |
| **RALPH commit**      | A git commit with the `RALPH:` prefix, containing structured metadata (task, decisions, files changed, blockers)                        | "bot commit", "automated commit"                                                                                   |

### Relationships

- The **wrapper script** manages the **sandbox** lifecycle and runs up to N **iterations**
- Each **iteration** produces at most one **RALPH commit** against one **task**
- After all **iterations** complete (or the **completion signal** fires), the **wrapper script** extracts a **patch** from the **sandbox** and applies it to the host repo
- The **prompt** is constant across all repos — it governs how RALPH selects a **task** from GitHub issues

### In context

> When you run the **wrapper script** from a local repo directory, it ensures the repo is cloned inside the **sandbox**, fetches open **tasks** from GitHub, and starts an **iteration**. RALPH follows the **prompt** to pick a **task**, implement it, and create a **RALPH commit**. If all **tasks** are done, RALPH emits the **completion signal** and the **wrapper script** extracts the **patch** to your host machine.

### Flagged ambiguities

- **"Docker sandbox"** — In this project this refers to our custom long-lived container, NOT Claude Code's built-in `docker sandbox` CLI feature (which we are deliberately avoiding due to unreliability). Use **sandbox** for ours, and "Docker sandbox CLI" or "`docker sandbox run`" when referring to the built-in feature.
- **"Container"** vs **"Sandbox"** — "Container" is the Docker primitive; "sandbox" is our specific use of it. Use **sandbox** when talking about the concept, "container" only when discussing Docker implementation details.
