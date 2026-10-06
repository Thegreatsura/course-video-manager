import { describe, expect, it } from "vitest";
import { findLopsidedQuizAnswers } from "./quiz-lint";

const quizWith = (correct: string, ...wrong: string[]) => {
  const choices = [correct, ...wrong]
    .map(
      (label, i) =>
        `      { answer: "${"abcd"[i]}", label: ${JSON.stringify(label)} }`
    )
    .join(",\n");
  return `<Quiz>
  <QuizQuestion data={{
    id: "the-question",
    question: "Which one?",
    type: "multiple-choice",
    choices: [
${choices}
    ],
    correct: "a",
    answer: "Because."
  }} />
</Quiz>`;
};

const SIMILAR = [
  "Restore the conversation but keep the code",
  "Restore the code but keep the conversation",
  "Choose nevermind and undo the files by hand",
];

describe("findLopsidedQuizAnswers", () => {
  it.each([
    {
      case: "a correct answer twice as long as similar distractors",
      correct:
        "Restore both the code and the conversation to the checkpoint, so the agent and files agree again",
      wrong: SIMILAR,
    },
    {
      case: "a terse correct answer among long distractors",
      correct: "Run /resume",
      wrong: SIMILAR,
    },
    {
      case: "a long correct answer whose length is padded with backticks",
      correct:
        "Run `claude --resume` and pick the session from the list, then keep going where you left off",
      wrong: [
        "Run `/clear` and start over",
        "Run `/compact` first",
        "Open a new tab",
      ],
    },
  ])("flags $case", ({ correct, wrong }) => {
    expect(findLopsidedQuizAnswers(quizWith(correct, ...wrong))).toHaveLength(
      1
    );
  });

  it.each([
    {
      case: "choices of similar length",
      correct: "Restore both the code and the conversation",
      wrong: SIMILAR,
    },
    {
      case: "short answers whose ratio is large but difference tiny",
      correct: "Yes, always",
      wrong: ["No", "Never"],
    },
    {
      case: "a correct answer a little longer than the rest",
      correct: "Restore both the code and the conversation from the checkpoint",
      wrong: SIMILAR,
    },
    {
      case: "a long correct answer when one distractor is just as long",
      correct:
        "Restore both the code and the conversation to the checkpoint, so they agree again",
      wrong: [
        "Restore only the conversation and then fix up every changed file by hand later",
        "Undo it",
      ],
    },
    {
      case: "a long correct answer whose extra length is a link target",
      correct:
        "Read [the docs](https://example.com/a/very/long/path/to/the/docs/page)",
      wrong: ["Ask the agent", "Guess and retry"],
    },
  ])("does not flag $case", ({ correct, wrong }) => {
    expect(findLopsidedQuizAnswers(quizWith(correct, ...wrong))).toEqual([]);
  });

  it("names the question and the lengths that tripped it", () => {
    expect(
      findLopsidedQuizAnswers(quizWith("Run /resume", ...SIMILAR))
    ).toEqual(["the-question (correct answer 11 chars, wrong choices 42-43)"]);
  });

  it("weighs every correct choice of a multi-select question", () => {
    const text = quizWith("Short one", "Short two", "Short three").replace(
      'correct: "a"',
      'correct: ["a", "b"]'
    );
    expect(findLopsidedQuizAnswers(text)).toEqual([]);
  });
});
