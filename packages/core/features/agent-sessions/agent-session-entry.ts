/**
 * An Agent Session Entry's content (GLOSSARY.md): one thing the Claude Code
 * session on screen showed, as one of five kinds. Every kind is a text field
 * or two; nothing here is a skill's body or a tool's result, and nothing ever
 * may be (`findAgentSessionContentProblems` refuses an upload that carries
 * either).
 *
 * - `userPrompt` — a prompt the author sent: typed, dictated or a slash
 *   command (written `/<name> <args>`).
 * - `assistantText` — one text block of Claude's reply, as Markdown source.
 * - `interrupt` — Claude Code's `[Request interrupted by user…]` marker.
 * - `skillCall` — a skill loaded, either by Claude calling the Skill tool
 *   (`toolCall`) or by the author typing its slash command (`slashCommand`).
 * - `toolCall` — a call to any other tool, as a stub: its name, a one-line
 *   summary and whether its result was an error.
 */
export const AGENT_SESSION_ENTRY_KINDS = [
  "userPrompt",
  "assistantText",
  "interrupt",
  "skillCall",
  "toolCall",
] as const;

export type AgentSessionEntryKind = (typeof AGENT_SESSION_ENTRY_KINDS)[number];

/** How a `skillCall` was made. */
export const SKILL_CALL_VIAS = ["toolCall", "slashCommand"] as const;

export type SkillCallVia = (typeof SKILL_CALL_VIAS)[number];

export type AgentSessionEntryContent =
  | { readonly kind: "userPrompt"; readonly text: string }
  | { readonly kind: "assistantText"; readonly text: string }
  | { readonly kind: "interrupt"; readonly text: string }
  | {
      readonly kind: "skillCall";
      readonly skill: string;
      readonly via: SkillCallVia;
      readonly args: string | null;
    }
  | {
      readonly kind: "toolCall";
      readonly tool: string;
      readonly summary: string | null;
      readonly resultIsError: boolean | null;
    };

/** The fields each kind may carry besides `kind`. Anything else is refused. */
export const FIELDS_OF_KIND: Record<
  AgentSessionEntryKind,
  ReadonlyArray<string>
> = {
  userPrompt: ["text"],
  assistantText: ["text"],
  interrupt: ["text"],
  skillCall: ["skill", "via", "args"],
  toolCall: ["tool", "summary", "resultIsError"],
};

/** The stored columns of an entry's content, every one nullable. */
export type AgentSessionEntryColumns = {
  readonly kind: AgentSessionEntryKind;
  readonly text: string | null;
  readonly skill: string | null;
  readonly via: SkillCallVia | null;
  readonly args: string | null;
  readonly tool: string | null;
  readonly summary: string | null;
  readonly resultIsError: boolean | null;
};

/** Content → its columns, the ones its kind does not use left null. */
export const toEntryColumns = (
  content: AgentSessionEntryContent
): AgentSessionEntryColumns => {
  const none = {
    text: null,
    skill: null,
    via: null,
    args: null,
    tool: null,
    summary: null,
    resultIsError: null,
  };
  switch (content.kind) {
    case "userPrompt":
    case "assistantText":
    case "interrupt":
      return { ...none, kind: content.kind, text: content.text };
    case "skillCall":
      return {
        ...none,
        kind: "skillCall",
        skill: content.skill,
        via: content.via,
        args: content.args,
      };
    case "toolCall":
      return {
        ...none,
        kind: "toolCall",
        tool: content.tool,
        summary: content.summary,
        resultIsError: content.resultIsError,
      };
  }
};

/** Columns → content, only the fields its kind carries. */
export const fromEntryColumns = (
  row: AgentSessionEntryColumns
): AgentSessionEntryContent => {
  switch (row.kind) {
    case "userPrompt":
    case "assistantText":
    case "interrupt":
      return { kind: row.kind, text: row.text ?? "" };
    case "skillCall":
      return {
        kind: "skillCall",
        skill: row.skill ?? "",
        via: row.via ?? "toolCall",
        args: row.args,
      };
    case "toolCall":
      return {
        kind: "toolCall",
        tool: row.tool ?? "",
        summary: row.summary,
        resultIsError: row.resultIsError,
      };
  }
};
