/**
 * Long-form --help text for `cvm video agent-sessions`. Domain-teaching prose
 * consumed only by Command.withDescription — keep in sync with GLOSSARY.md
 * (Agent Session, Agent Session Entry).
 */

export const AGENT_SESSIONS_HELP = `Agent Sessions — the Claude Code session(s) seen on screen in a Video.

An AGENT SESSION is one Claude Code session that was on screen while Clips were
filmed. Its AGENT SESSION ENTRIES are what it showed, each stored on the Clip
that shows it, at a Footage time (seconds into the Clip's Footage file, not
relative to the Clip's in-point). An entry is one of five kinds:
  userPrompt {text}       a prompt the author sent (a slash command is '/<name> <args>')
  assistantText {text}    one text block of Claude's reply
  interrupt {text}        Claude Code's '[Request interrupted by user…]' marker
  skillCall {skill, via, args}   a skill loaded; via 'toolCall' or 'slashCommand'
  toolCall {tool, summary, resultIsError}   any other tool call, as a stub
A skill's body and a tool's result are NEVER stored.

An Agent Session belongs to no Video: every copy of its Clips (a new Draft, a
duplicated Course) shares it. At Publish, each shipping Video's course.json entry
carries the entries it shows, timed in the current cut (visibleFrom).

Verbs:
  set <videoId> --session <jsonl> [--session <jsonl>…]   replace the Video's entries (WRITE)
  get <videoId>                                          every entry, with its visibleFrom and Clip
  clear <videoId>                                        remove the Video's entries (WRITE)

Worked example:
  cvm video agent-sessions set <id> --session ~/.claude/projects/<project>/<session>.jsonl
  cvm video agent-sessions get <id> | jq -r '[.visibleFrom, .kind, .text // .tool // .skill] | @tsv'`;

export const SET_HELP = `Replace a Video's Agent Session Entries with the session(s) in these Claude
Code session files (their JSONL transcripts). Repeat --session for a Video that
shows several sessions (one per /clear, say). WRITE: the Video must be in a
Draft (or standalone).

READING. Only the kept branch of each session is read: the newest message's
chain of parents. Rewound or abandoned branches, thinking, subagent transcripts,
/clear and system messages are dropped. A prompt's <pasted_content> wrapper is
dropped and the text inside it kept.

PATHS. Every path under the session's working directory is made relative to it,
and the working directory itself becomes ".". Any other absolute path is kept,
with its home directory (/home/<user>) written as "~". A "~/…" path is left as
written (it may be a TS path alias, like ~/db). A path never refuses an upload.

ANCHORING. Each entry goes to the FIRST screen Clip (any scene but Camera), in
video order, whose wall-clock end is after the time the entry was written. A
Clip's wall clock comes from its Recording Session's start, or for an OBS Clip
from its file name plus half a second. Entries written after the last screen
Clip are dropped.

REFUSALS. The whole upload is refused, and nothing stored, on: a skill's body or
a tool's result that would be stored; anything that looks like a secret (an API
key or token, a .env-style KEY=value, a URL with a password; a kebab-case slug
is not one); a session id that matches more than one Agent Session. Every reason is listed (exit 3).

SESSIONS. A session already stored (found by Claude Code's session id) is reused;
otherwise a new Agent Session is made. Every entry already on the Video's Clips
is replaced, in one transaction, and any Agent Session left with no entries
anywhere is deleted.

OUTPUT. One JSON object: per session, the Agent Session id, whether it was
reused, entries kept and entries dropped by reason; Clips with no known Footage
start; and how many empty Agent Sessions were deleted.`;

export const GET_HELP = `Print a Video's Agent Session Entries, NDJSON, one per line, for spot-checking
against the transcript. Sessions in the order they first appear in the cut;
within a session, by visibleFrom.

Fields: agentSessionId, sourceSessionId (Claude Code's id), sequence (its place
in the session), clipId, footageTime, visibleFrom (seconds into the exported
Video; null when it does not show in the current cut, e.g. its Clip was
archived, or trimmed past with no screen Clip after it), kind, then the kind's
fields.`;

export const CLEAR_HELP = `Remove every Agent Session Entry on a Video's Clips, then delete any Agent
Session left with no entries anywhere. WRITE: the Video must be in a Draft (or
standalone). Prints how many entries and Agent Sessions were deleted.`;
