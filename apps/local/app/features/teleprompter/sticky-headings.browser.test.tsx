import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { parseScriptBlocks } from "./script-blocks";
import { TeleprompterCrawl } from "./teleprompter-crawl";

/**
 * The pinned H1/H2/H3 are CSS sticky, offset by each other's laid-out height,
 * so whether they pin is a question only a real browser with the real
 * stylesheet can answer: each one must sit directly under the levels above it
 * while its section is on screen — however many lines those wrapped onto — and
 * be pushed off by the next heading of its rank or higher.
 */

const prose = (n: number) =>
  Array.from({ length: n }, (_, i) => `Line ${i} of prose read aloud.`).join(
    " "
  );

/** Far longer than one line of the 25ch measure, so its bar wraps. */
const LONG_H2 =
  "Alpha, a heading long enough to wrap onto several lines of the glass";

const SCRIPT = [
  "# Part one",
  prose(4),
  `## ${LONG_H2}`,
  prose(20),
  "### Alpha one",
  prose(40),
  "### Alpha two",
  prose(40),
  "# Part two",
  prose(10),
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

function heightOf(glass: HTMLElement, name: string) {
  return [...glass.querySelectorAll<HTMLElement>("[data-sticky-heading]")]
    .find((el) => el.textContent === name)!
    .getBoundingClientRect().height;
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
  it("stacks the current H1, H2 and H3, each under the real height of the ones above", async () => {
    const screen = render(
      <Glass>
        <TeleprompterCrawl blocks={parseScriptBlocks(SCRIPT)} />
      </Glass>
    );
    const glass = screen.container.firstElementChild as HTMLElement;
    const scroller = glass.querySelector<HTMLElement>("[data-crawl-scroller]")!;

    const scrollTo = async (target: number) => {
      scroller.scrollTop = target;
      await expect.poll(() => scroller.scrollTop).toBe(target);
    };

    await scrollTo(
      Math.round(sectionStart(glass, "Alpha two", scroller)) + 200
    );
    const h1Height = heightOf(glass, "Part one");
    const h2Height = heightOf(glass, LONG_H2);
    // Wrapped, not cut to one line.
    expect(h2Height).toBeGreaterThan(h1Height * 2);
    // The offsets follow layout through the browser's ResizeObserver.
    await expect
      .poll(() => headingTops(glass)["Alpha two"])
      .toBe(Math.round(h1Height + h2Height));
    const inAlphaTwo = headingTops(glass);
    expect(inAlphaTwo["Part one"]).toBe(0);
    expect(inAlphaTwo[LONG_H2]).toBe(Math.round(h1Height));
    expect(inAlphaTwo["Alpha one"]).toBeLessThan(0);

    // A new H1 pushes the whole stack off.
    await scrollTo(Math.round(sectionStart(glass, "Beta", scroller)) + 200);
    const inBeta = headingTops(glass);
    expect(inBeta["Part two"]).toBe(0);
    expect(inBeta["Beta"]).toBe(Math.round(heightOf(glass, "Part two")));
    expect(inBeta["Part one"]).toBeLessThan(0);
    expect(inBeta[LONG_H2]).toBeLessThan(0);
    expect(inBeta["Alpha two"]).toBeLessThan(0);
  });
});
