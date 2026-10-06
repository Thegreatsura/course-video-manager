import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentPanel } from "./document-panel";

const pasteButton = (html: string) =>
  html.match(/<button[^>]*>(?:(?!<\/button>).)*Paste from Clipboard/s)?.[0];

describe("DocumentPanel while the model is generating", () => {
  it("disables pasting a document in so it cannot race the stream", () => {
    const html = renderToStaticMarkup(
      <DocumentPanel
        document={undefined}
        fullPath="/tmp"
        onDocumentChange={() => {}}
        readOnly
      />
    );
    expect(pasteButton(html)).toMatch(/ disabled=""/);
  });

  it("allows pasting again once generation finishes", () => {
    const html = renderToStaticMarkup(
      <DocumentPanel
        document={undefined}
        fullPath="/tmp"
        onDocumentChange={() => {}}
      />
    );
    expect(pasteButton(html)).not.toMatch(/ disabled=""/);
  });
});
