import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantMessage } from "./assistant-message";

function classesOf(tag: string) {
  return (tag.match(/class="([^"]*)"/)?.[1] ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&gt;", ">")
    .split(" ");
}

describe("AssistantMessage", () => {
  it("stacks its parts vertically at full width inside the row-flex AIMessage", () => {
    const html = renderToStaticMarkup(
      <AssistantMessage>
        <p>tool call</p>
        <p>text</p>
      </AssistantMessage>
    );
    // <div row><div parts>…parts…</div></div> — the parts are never direct
    // children of the flex-row AIMessage.
    const [outerTag, partsTag] = html.match(/<div[^>]*>/g)!;
    expect(html).toMatch(
      /^<div[^>]*><div[^>]*><p>tool call<\/p><p>text<\/p><\/div><\/div>$/
    );

    expect(partsTag).toContain('data-testid="assistant-message-parts"');
    expect(classesOf(partsTag!)).toEqual(
      expect.arrayContaining(["flex", "flex-col", "w-full"])
    );
    expect(classesOf(outerTag!)).toContain("[&>div]:max-w-full");
    expect(classesOf(outerTag!)).not.toContain("[&>div]:max-w-[80%]");
  });
});
