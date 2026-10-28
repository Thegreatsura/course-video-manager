import { describe, expect, it } from "vitest";
import { findUnevenQuizAnswers } from "./quiz-lint";

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

describe("findUnevenQuizAnswers", () => {
  it("passes choices exactly 10 characters apart", () => {
    expect(
      findUnevenQuizAnswers(
        quizWith("a".repeat(15), "b".repeat(5), "c".repeat(9))
      )
    ).toEqual([]);
  });

  it("flags choices 11 characters apart, naming the gap", () => {
    expect(
      findUnevenQuizAnswers(
        quizWith("a".repeat(16), "b".repeat(5), "c".repeat(9))
      )
    ).toEqual(["the-question: Answers differ by 11 characters (max 10)"]);
  });

  it("flags a gap between two wrong choices, not only the correct one", () => {
    expect(
      findUnevenQuizAnswers(
        quizWith("a".repeat(10), "b".repeat(4), "c".repeat(16))
      )
    ).toHaveLength(1);
  });

  it("measures the text the reader sees, trimmed", () => {
    expect(
      findUnevenQuizAnswers(
        quizWith(
          "  Read [the docs](https://example.com/a/very/long/path)  ",
          "Run `/clear` now",
          "**Guess** again"
        )
      )
    ).toEqual([]);
  });
});
