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
 * A correct answer this much longer than the longest wrong choice — or this
 * much shorter than the shortest — gives itself away.
 *
 * Measured against the extreme distractor, not their average, so a question
 * whose wrong choices already vary widely is left alone: the tell is a correct
 * answer standing apart from a cluster. 1.5x / 0.6x is where a reader skimming
 * the options sees one stick out. The absolute floor keeps short choices quiet
 * — "Yes" against "No" is 1.5x and means nothing. Checked against the 91
 * questions in the courses on 2026-10-06: none flagged, the nearest being an
 * 82-char answer beside a 60-char distractor (1.37x, +22).
 */
const LONGER_RATIO = 1.5;
const SHORTER_RATIO = 0.6;
const MIN_DIFFERENCE = 25;

/** A choice as the reader sees it: no backticks, emphasis or link targets. */
function renderedLength(label: string): number {
  return label
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Questions whose correct answer is egregiously longer or shorter than the
 * wrong choices, each described by id and the lengths that tripped it.
 */
export function findLopsidedQuizAnswers(text: string): string[] {
  const found: string[] = [];
  for (const block of parseQuizBlocks(text)) {
    for (const { data } of block.questions) {
      if (!data || !Array.isArray(data.choices)) continue;
      const correct = new Set(
        Array.isArray(data.correct) ? data.correct : [data.correct]
      );
      const right: number[] = [];
      const wrong: number[] = [];
      for (const choice of data.choices) {
        if (typeof choice?.label !== "string") continue;
        (correct.has(choice.answer) ? right : wrong).push(
          renderedLength(choice.label)
        );
      }
      if (right.length === 0 || wrong.length === 0) continue;

      const longest = Math.max(...wrong);
      const shortest = Math.min(...wrong);
      const range = `${shortest === longest ? longest : `${shortest}-${longest}`}`;
      for (const length of right) {
        const tooLong =
          length > longest * LONGER_RATIO && length - longest >= MIN_DIFFERENCE;
        const tooShort =
          length < shortest * SHORTER_RATIO &&
          shortest - length >= MIN_DIFFERENCE;
        if (tooLong || tooShort) {
          found.push(
            `${data.id || "(no id)"} (correct answer ${length} chars, wrong choices ${range})`
          );
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Generated quizzes put the correct answer in the same slot — nearly always the
 * first — and a reader who notices stops reading the question. Three questions
 * all in one slot is past chance (1 in 9 with three choices, 1 in 16 with
 * four); from four questions on, three in four sharing a slot is enough. Fewer
 * than three is too few to call a pattern. Multi-select questions have no
 * single position and are left out.
 */
const STACKED_MIN_QUESTIONS = 3;
const STACKED_MAJORITY_FROM = 4;
const STACKED_MAJORITY = 0.75;

/**
 * Describes the document's correct answers when one option position holds all
 * of them (or a clear majority), or returns nothing.
 */
export function findStackedCorrectPositions(text: string): string[] {
  const positions: number[] = [];
  for (const block of parseQuizBlocks(text)) {
    for (const { data } of block.questions) {
      if (!data || typeof data.correct !== "string") continue;
      if (!Array.isArray(data.choices)) continue;
      const at = data.choices.findIndex((c) => c?.answer === data.correct);
      if (at !== -1) positions.push(at);
    }
  }
  if (positions.length < STACKED_MIN_QUESTIONS) return [];

  const counts = new Map<number, number>();
  for (const at of positions) counts.set(at, (counts.get(at) ?? 0) + 1);
  const [position, count] = [...counts].sort((a, b) => b[1] - a[1])[0]!;

  const stacked =
    count === positions.length ||
    (positions.length >= STACKED_MAJORITY_FROM &&
      count / positions.length >= STACKED_MAJORITY);
  return stacked
    ? [
        `option ${position + 1} is correct in ${count} of ${positions.length} questions`,
      ]
    : [];
}
