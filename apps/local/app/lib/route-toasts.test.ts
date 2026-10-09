import { describe, expect, it } from "vitest";
import { NO_TOASTS, toastsAllowed } from "./route-toasts";
import * as teleprompter from "@/routes/teleprompter";
import * as playgroundHome from "@/routes/diagram-playground._index";
import * as playgroundDiagram from "@/routes/diagram-playground.$diagramId";
import * as appLayout from "@/routes/_app";

// A route module, as root's `useMatches()` sees it: the root match plus its handle.
const matchesFor = (...modules: object[]) => [
  { handle: undefined },
  ...modules.map((m) => ({ handle: "handle" in m ? m.handle : undefined })),
];

describe("toastsAllowed", () => {
  it("shows toasts when no route opts out", () => {
    expect(
      toastsAllowed([{ handle: undefined }, { handle: { fullscreen: true } }])
    ).toBe(true);
  });

  it("hides toasts when any matched route opts out", () => {
    expect(toastsAllowed([{ handle: undefined }, { handle: NO_TOASTS }])).toBe(
      false
    );
  });

  it.each([
    ["teleprompter", teleprompter],
    ["diagram-playground._index", playgroundHome],
    ["diagram-playground.$diagramId", playgroundDiagram],
  ])("the %s route opts out of toasts", (_name, mod) => {
    expect(toastsAllowed(matchesFor(mod))).toBe(false);
  });

  it("an ordinary app route still shows toasts", () => {
    expect(toastsAllowed(matchesFor(appLayout))).toBe(true);
  });
});
