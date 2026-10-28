import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialDocumentFlowState,
  displayedDocument,
  documentFlowReducer,
} from "./document-flow-reducer";
import { fromPartial } from "@total-typescript/shoehorn";
import {
  replaceChooseScreenshotWithImage,
  setChooseScreenshotFace,
} from "./choose-screenshot-mutations";
import { removeMarkdownBlock } from "./remove-markdown-block";
import type { SettledDocumentToolPart } from "./document-tool-calls";

const tag = (clipIndex: number, alt: string) =>
  `<ChooseScreenshot clipIndex={${clipIndex}} alt="${alt}" />`;

/** A writer whose model is part-way through a `writeDocument`. */
function midStream(content: string) {
  return new ReducerTester(
    documentFlowReducer,
    createInitialDocumentFlowState("# Old")
  )
    .send({ type: "turn-started" })
    .send({ type: "document-streamed", toolCallId: "write-1", content });
}

/** The user's gesture, as the runtime reports it: the shown document, rewritten. */
function edit(
  tester: ReturnType<typeof midStream>,
  rewrite: (shown: string) => string
) {
  const before = displayedDocument(tester.getState())!;
  return tester.send({
    type: "document-edited",
    before,
    after: rewrite(before),
  });
}

describe("documentFlowReducer", () => {
  it("a screenshot chosen mid-stream shows at once, survives the rest of the stream, and is saved in one step when it ends", () => {
    const tester = midStream(`Intro\n\n${tag(1, "a")}\n\nMore`);

    edit(tester, (doc) => setChooseScreenshotFace(doc, 1, "a", "with"));
    edit(tester, (doc) =>
      replaceChooseScreenshotWithImage(doc, 1, "a", "./screenshot-1.png")
    );
    tester.send({
      type: "document-streamed",
      toolCallId: "write-1",
      content: `Intro\n\n${tag(1, "a")}\n\nMore text arrives.`,
    });

    const expected = `Intro\n\n![a](./screenshot-1.png)\n\nMore text arrives.`;
    expect(displayedDocument(tester.getState())).toBe(expected);

    tester.resetExec().send({ type: "turn-ended" });

    expect(tester.getState().text).toBe(expected);
    expect(tester.getState().pendingEdits).toEqual([]);
    expect(tester.getEffects()).toEqual([
      { type: "notify-document-changed", document: expected },
    ]);
  });

  it("deleting a block mid-stream takes any queued edit inside it, and leaves the rest", () => {
    const tester = midStream(
      `Keep\n\n${tag(1, "a")}\n\n${tag(2, "b")}\n\nTail`
    );

    edit(tester, (doc) => setChooseScreenshotFace(doc, 1, "a", "with"));
    edit(tester, (doc) => setChooseScreenshotFace(doc, 2, "b", "diagram"));
    edit(tester, (doc) => {
      const start = doc.indexOf("<ChooseScreenshot clipIndex={1}");
      return removeMarkdownBlock(doc, start, doc.indexOf("/>", start) + 2);
    });

    expect(displayedDocument(tester.getState())).toBe(
      `Keep\n\n<ChooseScreenshot clipIndex={2} alt="b" face="diagram" />\n\nTail`
    );
    expect(tester.getState().pendingEdits).toHaveLength(2);
  });

  it("refuses an edit to the line still arriving", () => {
    const tester = midStream(`Intro\n\n${tag(1, "a")}`);

    edit(tester, (doc) => setChooseScreenshotFace(doc, 1, "a", "with"));

    expect(displayedDocument(tester.getState())).toBe(
      `Intro\n\n${tag(1, "a")}`
    );
    expect(tester.getEffects().at(-1)).toEqual({
      type: "show-warning",
      message:
        "That line is still being written. Try again once it has arrived.",
    });
  });

  it("drops an edit whose text the model rewrites, and never applies it elsewhere", () => {
    const content = `Intro\n\n${tag(1, "a")}\n\n${tag(2, "b")}\n\nEnd`;
    const tester = midStream(content);
    edit(tester, (doc) => {
      const start = doc.indexOf("<ChooseScreenshot");
      return doc.slice(0, start) + doc.slice(start + tag(1, "a").length + 2);
    });

    // The model's editDocument rewrites the first placeholder.
    tester.resetExec().send({
      type: "document-tool-calls-settled",
      calls: [
        fromPartial<SettledDocumentToolPart>({
          type: "tool-editDocument",
          toolCallId: "edit-1",
          state: "input-available",
          input: {
            edits: [
              {
                type: "replace",
                old_text: `Intro\n\n${tag(1, "a")}`,
                new_text: `Intro\n\n${tag(3, "c")}`,
              },
            ],
          },
        }),
      ],
    });
    tester.send({ type: "turn-ended" });

    expect(tester.getState().text).toBe(
      `Intro\n\n${tag(3, "c")}\n\n${tag(2, "b")}\n\nEnd`
    );
    expect(tester.getEffects().map((e) => e.type)).toEqual([
      "show-warning",
      "report-tool-outputs",
      "notify-document-changed",
    ]);
  });

  it("a new write discards the queued edits, with a warning", () => {
    const tester = midStream(`Intro\n\n${tag(1, "a")}\n\n`);
    edit(tester, (doc) => setChooseScreenshotFace(doc, 1, "a", "with"));

    tester
      .resetExec()
      .send({
        type: "document-streamed",
        toolCallId: "write-2",
        content: "Fresh",
      })
      .send({ type: "turn-ended" });

    expect(tester.getState().text).toBe("Fresh");
    expect(tester.getEffects()).toEqual([
      {
        type: "show-warning",
        message:
          "Dropped 1 edit you made while the model wrote: it started the document again.",
      },
      { type: "notify-document-changed", document: "Fresh" },
    ]);
  });
});
