/**
 * Turns a Video's Script (one flowing markdown document, per CONTEXT.md) into
 * blocks a teleprompter can move through: headings, paragraphs, lists, and
 * bracketed cues.
 *
 * Splitting is done here rather than by a markdown parser because the crawl
 * needs the blocks as separate nodes — to style them differently, and to measure
 * pace from spoken prose alone. `text` stays as raw markdown; the renderer
 * handles inline formatting from there.
 *
 * Two kinds are not split on blank lines: a fenced code block, which is copied
 * out whole, and a `<setup>…</setup>` region, the production notes read before
 * the take.
 */

export type ScriptBlock = {
  id: string;
  /**
   * heading = section marker, cue = "[bracketed improv note]", list = bullets
   * or numbered steps, para = verbatim prose, code = a fenced block to copy
   * and paste (a command, a file's contents), setup = a `<setup>` region of
   * production notes read before the take, never aloud.
   */
  kind: "heading" | "para" | "cue" | "list" | "code" | "setup";
  /**
   * Raw markdown. For "code", the fence's contents exactly as written. For
   * "setup", the markdown between the tags — parse it again for its blocks.
   */
  text: string;
  /** Heading depth, 1-6. Only meaningful for kind "heading". */
  level: number;
};

/** A line opening a bullet or numbered list item. */
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** A line opening or closing a fenced code block: ``` or ~~~, three or more. */
const FENCE = /^\s*(`{3,}|~{3,})/;

const SETUP_OPEN = /^\s*<setup>\s*$/i;
const SETUP_CLOSE = /^\s*<\/setup>\s*$/i;

/**
 * A stretch of the script before it is split into blocks. A fence and a setup
 * region each stay whole: a blank line inside one is part of it, not a break
 * between blocks.
 */
type Segment = { kind: "prose" | "code" | "setup"; text: string };

function segment(script: string): Segment[] {
  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const segments: Segment[] = [];
  let prose: string[] = [];

  const flushProse = () => {
    if (prose.length > 0) {
      segments.push({ kind: "prose", text: prose.join("\n") });
    }
    prose = [];
  };

  /**
   * The body of the fence opened at `start`, up to the line that closes it
   * with the same marker. An unclosed fence runs to the end of the script, as
   * it does in any markdown renderer.
   */
  const readFence = (start: number) => {
    const marker = lines[start]!.match(FENCE)![1]!;
    let end = start + 1;
    while (end < lines.length && !lines[end]!.trim().startsWith(marker)) end++;
    return { body: lines.slice(start + 1, end), next: end + 1 };
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      flushProse();
      const { body, next } = readFence(i);
      segments.push({ kind: "code", text: body.join("\n") });
      i = next;
    } else if (SETUP_OPEN.test(line)) {
      flushProse();
      // Fences are read whole, so a `</setup>` inside one doesn't close the
      // region.
      const inner: string[] = [];
      i++;
      while (i < lines.length && !SETUP_CLOSE.test(lines[i]!)) {
        if (FENCE.test(lines[i]!)) {
          const { next } = readFence(i);
          inner.push(...lines.slice(i, next));
          i = next;
        } else {
          inner.push(lines[i]!);
          i++;
        }
      }
      segments.push({ kind: "setup", text: inner.join("\n").trim() });
      i++;
    } else {
      prose.push(line);
      i++;
    }
  }
  flushProse();
  return segments;
}

export function parseScriptBlocks(script: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  const nextId = () => `b${blocks.length}`;

  for (const seg of segment(script)) {
    if (seg.kind === "code") {
      blocks.push({ id: nextId(), kind: "code", text: seg.text, level: 0 });
    } else if (seg.kind === "setup") {
      if (seg.text) {
        blocks.push({ id: nextId(), kind: "setup", text: seg.text, level: 0 });
      }
    } else {
      seg.text
        .split(/\n\s*\n/)
        .map((c) => c.trim())
        .filter(Boolean)
        .forEach((raw) => blocks.push(proseBlock(nextId(), raw)));
    }
  }
  return blocks;
}

function proseBlock(id: string, raw: string): ScriptBlock {
  const headingMatch = raw.match(/^(#{1,6})\s+(.*)$/s);
  if (headingMatch) {
    return {
      id,
      kind: "heading",
      text: headingMatch[2]!.trim(),
      level: headingMatch[1]!.length,
    };
  }
  // A block that is entirely one bracketed note is a cue: something to do,
  // not something to read aloud.
  if (/^\[[\s\S]*\]$/.test(raw)) {
    return {
      id,
      kind: "cue",
      text: raw.replace(/^\[|\]$/g, "").trim(),
      level: 0,
    };
  }
  // A chunk whose every line opens a list item is a list, and keeps its line
  // breaks — they're the structure, not accidental wrapping.
  const lines = raw.split("\n");
  if (lines.length > 0 && lines.every((line) => LIST_ITEM.test(line))) {
    return { id, kind: "list", text: raw, level: 0 };
  }
  // Collapse hard-wrapped lines so the reader controls line breaks, not the
  // author's editor width.
  return {
    id,
    kind: "para",
    text: raw.replace(/\n+/g, " ").replace(/\s{2,}/g, " "),
    level: 0,
  };
}

/**
 * Rough word count, for calibrating the crawl's speed. Markdown syntax is
 * stripped first: `**emphasis**` is one spoken word, and a `-` bullet is none.
 */
export function wordCount(text: string): number {
  return text
    .split("\n")
    .map((line) => line.replace(LIST_ITEM, ""))
    .join(" ")
    .replace(/[*_`~]/g, "")
    .split(/\s+/)
    .filter(Boolean).length;
}
