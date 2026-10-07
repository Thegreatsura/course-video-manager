import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { AnimaticLine } from "@/features/animatic/animatic-lines";
import { AnimaticView } from "./animatic-view";
import { parseScriptBlocks } from "./script-blocks";
import { TeleprompterCrawl } from "./teleprompter-crawl";

/**
 * The pinned H2/H3 are pure CSS sticky, so whether they pin is a question
 * only a real browser with the real stylesheet can answer: each one must sit
 * at the top of the glass while its section is on screen, and be pushed off by
 * the next heading of its rank.
 */

const prose = (n: number) =>
  Array.from({ length: n }, (_, i) => `Line ${i} of prose read aloud.`).join(
    " "
  );

const SCRIPT = [
  "# Title",
  prose(4),
  "## Alpha",
  prose(20),
  "### Alpha one",
  prose(40),
  "### Alpha two",
  prose(40),
  "## Beta",
  prose(40),
].join("\n\n");

function Glass(props: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative", width: 1000, height: 600 }}>
      {props.children}
    </div>
  );
}

/** Where each heading sits, relative to the top of the glass. */
function headingTops(glass: HTMLElement) {
  const top = glass.getBoundingClientRect().top;
  return Object.fromEntries(
    [...glass.querySelectorAll<HTMLElement>("[data-sticky-heading]")].map(
      (el) => [el.textContent, Math.round(el.getBoundingClientRect().top - top)]
    )
  );
}

/** The section a heading opens, measured from the top of the scroll. */
function sectionStart(glass: HTMLElement, name: string, scroller: HTMLElement) {
  const heading = [
    ...glass.querySelectorAll<HTMLElement>("[data-sticky-heading]"),
  ].find((el) => el.textContent === name)!;
  const section = heading.parentElement!;
  return (
    section.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop
  );
}

describe("pinned headings on the glass", () => {
  it("pins the current H2 and, under it, the current H3 as the Script crawls", async () => {
    const screen = render(
      <Glass>
        <TeleprompterCrawl
          blocks={parseScriptBlocks(SCRIPT)}
          wpm={200}
          playing={false}
          onTogglePlay={() => {}}
          onRewind={() => {}}
        />
      </Glass>
    );
    const glass = screen.container.firstElementChild as HTMLElement;
    const scroller = glass.querySelector<HTMLElement>("[data-crawl-scroller]")!;

    // The wheel is how the author scrolls between takes; it goes through the
    // crawl's own loop, which is what moves the scroll container.
    const wheelTo = async (target: number) => {
      glass.firstElementChild!.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: target - scroller.scrollTop,
          bubbles: true,
        })
      );
      await expect.poll(() => scroller.scrollTop).toBe(target);
    };

    await wheelTo(Math.round(sectionStart(glass, "Alpha two", scroller)) + 200);
    const inAlphaTwo = headingTops(glass);
    const h2Height = glass
      .querySelector<HTMLElement>("[data-sticky-heading=h2]")!
      .getBoundingClientRect().height;
    expect(inAlphaTwo["Alpha"]).toBe(0);
    expect(inAlphaTwo["Alpha two"]).toBe(Math.round(h2Height));
    expect(inAlphaTwo["Alpha one"]).toBeLessThan(0);

    await wheelTo(Math.round(sectionStart(glass, "Beta", scroller)) + 200);
    const inBeta = headingTops(glass);
    expect(inBeta["Beta"]).toBe(0);
    expect(inBeta["Alpha"]).toBeLessThan(0);
    expect(inBeta["Alpha two"]).toBeLessThan(0);
  });

  it("pins the current Clip Mockup Chapter in the Animatic", async () => {
    let position = 0;
    const lines: AnimaticLine[] = ["One", "Two"].flatMap((name) => [
      { type: "chapter", id: name, name, comments: [] },
      ...Array.from({ length: 10 }, (_, i): AnimaticLine => {
        position++;
        return {
          type: "clip-mockup",
          id: `${name}-${i}`,
          line: prose(6),
          comments: [],
          position,
        };
      }),
    ]);
    const screen = render(
      <Glass>
        <AnimaticView lines={lines} />
      </Glass>
    );
    const glass = screen.container.firstElementChild as HTMLElement;
    const scroller = glass.querySelector<HTMLElement>(".overflow-y-scroll")!;

    scroller.scrollTop = sectionStart(glass, "Two", scroller) - 300;
    await expect.poll(() => headingTops(glass)["One"]).toBe(0);

    scroller.scrollTop = sectionStart(glass, "Two", scroller) + 300;
    await expect.poll(() => headingTops(glass)["Two"]).toBe(0);
    expect(headingTops(glass)["One"]).toBeLessThan(0);
  });
});
