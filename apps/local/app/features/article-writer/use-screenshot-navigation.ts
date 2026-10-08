import { useEffect, useRef, type RefObject } from "react";
import {
  CHOOSE_SCREENSHOT_ATTR,
  SCREENSHOT_STEP_EVENT,
  pickCurrentScreenshot,
  pickScreenshotTarget,
  screenshotNavDirection,
  screenshotStepDirection,
} from "./screenshot-navigation";

const HIGHLIGHT_CLASSES = ["ring-2", "ring-primary", "ring-offset-2"];
const HIGHLIGHT_MS = 1200;

/**
 * L / K step through the preview's `<ChooseScreenshot>` placeholders, and I / O
 * nudge the current one's frame. Mount it only while the preview is showing.
 *
 * Scoped to keys pressed inside the dialog that holds the preview. The Video
 * page's own L / K (2x / 1x) and the Animatic page's both refuse any key from
 * inside a dialog, so exactly one handler ever acts on a press.
 */
export function useScreenshotNavigation(
  previewRef: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  const lastVisited = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    lastVisited.current = null;

    const onKeyDown = (e: KeyboardEvent) => {
      const preview = previewRef.current;
      if (!preview) return;
      const direction = screenshotNavDirection(e);
      const stepDirection = screenshotStepDirection(e);
      if (direction === null && stepDirection === null) return;

      const scope = preview.closest('[role="dialog"]') ?? document.body;
      if (!(e.target instanceof Node) || !scope.contains(e.target)) return;

      const placeholders = Array.from(
        preview.querySelectorAll<HTMLElement>(`[${CHOOSE_SCREENSHOT_ATTR}]`)
      );
      if (placeholders.length === 0) return;
      e.preventDefault();

      const box = preview.getBoundingClientRect();
      const spans = placeholders.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top - box.top, bottom: r.bottom - box.top };
      });
      const viewportHeight = preview.clientHeight;

      if (stepDirection !== null) {
        const current = pickCurrentScreenshot({
          spans,
          viewportHeight,
          lastVisited: lastVisited.current,
        });
        if (current === null) return;
        placeholders[current]!.dispatchEvent(
          new CustomEvent(SCREENSHOT_STEP_EVENT, { detail: stepDirection })
        );
        return;
      }
      if (direction === null) return;

      const target = pickScreenshotTarget({
        spans,
        viewportHeight,
        lastVisited: lastVisited.current,
        direction,
      });
      if (target === null) return;

      lastVisited.current = target;
      const el = placeholders[target]!;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add(...HIGHLIGHT_CLASSES);
      window.setTimeout(
        () => el.classList.remove(...HIGHLIGHT_CLASSES),
        HIGHLIGHT_MS
      );
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewRef, enabled]);
}
