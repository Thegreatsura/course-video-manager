/**
 * What the Article Writer knows about commit maps.
 *
 * The syntax here is one of two live copies — the other is the
 * `commit-maps.md` reference in the `creating-content` skill, which holds the
 * same contract for agents drafting outside this app. Change both.
 *
 * The writer cannot see the course repo, so it writes a map from the slugs it
 * is handed — usually a "Commit map" section in the video's attached writer
 * notes, which the `prepare-for-writing` skill reads off the repo. No slugs,
 * no map: an invented slug sends the reader somewhere that doesn't exist.
 */

export const COMMIT_MAP_INSTRUCTIONS = `
## Commit Maps

Some lessons open with a commit map: the list of commits in the course project repo that the lesson uses.

**Write one whenever you have been given the lesson's commits.** You cannot see the course repo, so the slugs must come to you. Look for them in:

- the supporting material — the video's writer notes usually carry a "Commit map" section listing the slugs, which is the reset point and which is the solution, and the course repo's package manager
- the setup beats in the beat plan, which sometimes name a slug
- the course memory
- the user's own messages

Each slug is the id of a real commit, so copy it exactly as given. **If you have been given no slugs, write no commit map** — never guess one from the lesson title or the code. If a lesson already has a commit map, leave it alone unless asked: do not reword its descriptions, reorder its entries, or move it.

This is the shape:

<CommitMap>
  <Commit id="analytics-tickets">Start the lesson — the PRD turned into multi-phase tickets</Commit>
  <Commit id="implement-skill">See my solution — the \`/implement\` skill added</Commit>
</CommitMap>

The rules:

- It goes at the **top of the body**, before the first line of prose. It is navigation: the reader needs it before they start, not after.
- The opening tag may carry \`packageManager="npm"\`: \`<CommitMap packageManager="npm">\`. Omit it and the course repo is assumed to use pnpm — that is still true for most courses. Set it only when you are told the course's repo uses npm — the writer notes say which package manager the repo uses. Never guess it.
- Each \`id\` is a **slug** — the id of a commit in the course project repo, in kebab-case. It names what the commit does to the tree (\`add-settings-json\`), not the lesson it appears in. Never invent a slug. Use the ones you are given.
- \`main\` is the one legal id that is not a slug. It names the course's starting point, the state a student first clones.
- The **first entry is the reset point** — where a student goes to start the lesson. Later entries are the other points the lesson mentions, in the order the lesson reaches them.
- Each description says what the reader gets by going there, in the lesson's own terms — "Start the lesson — …", "See my solution — …". It is not the commit's message. Markdown works inside it; backticks for file and skill names.
- **No blank lines anywhere inside the block.** The opening tag, every \`<Commit>\`, and the closing tag sit on consecutive lines. A blank line changes how the page parses, and an unclosed \`<CommitMap>\` breaks the entire lesson body.
- Each commit appears once. A \`<Commit>\` outside a \`<CommitMap>\` means nothing.
`.trim();
