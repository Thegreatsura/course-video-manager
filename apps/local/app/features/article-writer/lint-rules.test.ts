import { describe, expect, it } from "vitest";
import { BASE_LINT_RULES, EMPTY_LINT_CONTEXT } from "./lint-rules";

const QUIZ = `<Quiz>
  <QuizQuestion data={{
    id: "the-question",
    question: "Which one?",
    type: "multiple-choice",
    choices: [
      { answer: "a", label: "This one" },
      { answer: "b", label: "That one" }
    ],
    correct: "a",
    answer: "Because."
  }} />
</Quiz>`;

describe("explainer-needs-quiz", () => {
  const rule = BASE_LINT_RULES.find((r) => r.id === "explainer-needs-quiz")!;
  const detect = (text: string) => rule.detect!(text, EMPTY_LINT_CONTEXT);

  it("flags an Explainer body with no Quiz, and only in Explainer mode", () => {
    expect(rule.modes).toEqual(["explainer"]);
    expect(detect("Some prose about the idea.")).toHaveLength(1);
  });

  it("passes an Explainer body that holds a Quiz", () => {
    expect(detect(`Some prose about the idea.\n\n${QUIZ}\n`)).toEqual([]);
  });
});
