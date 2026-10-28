/**
 * What the prose linters may see of a quiz, and the one lint that is about
 * quizzes rather than prose.
 */

import { parseQuizBlocks } from "./quiz-syntax";
import { collectQuizIds } from "./quiz-syntax";
import { renameCollidingQuizIds } from "./quiz-ids";

/**
 * Hides everything in a quiz except the prose a reader sees.
 *
 * A banned phrase inside a question is a real violation, so the linters read
 * `question` and `answer`. An id, a choice's `answer` key and the JSX around
 * them are structure: a rule matching there would report a violation whose fix
 * breaks the block. Replaced rather than removed so a phrase cannot be formed
 * by two fragments meeting.
 */
export function maskQuizNonProse(text: string): string {
  const blocks = parseQuizBlocks(text);
  if (blocks.length === 0) return text;

  let out = "";
  let at = 0;
  for (const block of blocks) {
    out += text.slice(at, block.start);
    for (const question of block.questions) {
      const data = question.data;
      if (!data) continue;
      out += `\n${data.question ?? ""}\n${data.answer ?? ""}\n`;
      for (const choice of data.choices ?? []) out += `${choice.label}\n`;
    }
    at = block.end;
  }
  return out + text.slice(at);
}

/** Ids used more than once in one document. */
export function findRepeatedQuizIds(text: string): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of collectQuizIds(text)) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated];
}

/**
 * Quiz ids in this document that another video in the course already owns, plus
 * any the document repeats itself.
 */
export function findTakenQuizIds(
  text: string,
  courseQuizIds: Iterable<string>
): string[] {
  const taken = new Set(courseQuizIds);
  const clashes = new Set(findRepeatedQuizIds(text));
  for (const id of collectQuizIds(text)) if (taken.has(id)) clashes.add(id);
  return [...clashes];
}

/** Renames the clashing ids, leaving the first honest use of each alone. */
export function fixTakenQuizIds(
  text: string,
  courseQuizIds: Iterable<string>
): string {
  return renameCollidingQuizIds(text, courseQuizIds);
}

/**
 * The most a question's choices may differ in length, in characters. Any wider
 * and the odd one out — usually the correct answer, written with more care —
 * stands out to a reader skimming the options.
 */
export const MAX_QUIZ_ANSWER_LENGTH_GAP = 10;

/** A choice as the reader sees it: no backticks, emphasis or link targets. */
function renderedLength(label: string): number {
  return label
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Questions whose longest choice is more than `MAX_QUIZ_ANSWER_LENGTH_GAP`
 * characters longer than their shortest, correct or not, each described by id
 * and the gap.
 */
export function findUnevenQuizAnswers(text: string): string[] {
  const found: string[] = [];
  for (const block of parseQuizBlocks(text)) {
    for (const { data } of block.questions) {
      if (!data || !Array.isArray(data.choices)) continue;
      const lengths = data.choices
        .filter((choice) => typeof choice?.label === "string")
        .map((choice) => renderedLength(choice.label));
      if (lengths.length < 2) continue;

      const gap = Math.max(...lengths) - Math.min(...lengths);
      if (gap > MAX_QUIZ_ANSWER_LENGTH_GAP) {
        found.push(
          `${data.id || "(no id)"}: Answers differ by ${gap} characters (max ${MAX_QUIZ_ANSWER_LENGTH_GAP})`
        );
      }
    }
  }
  return found;
}
