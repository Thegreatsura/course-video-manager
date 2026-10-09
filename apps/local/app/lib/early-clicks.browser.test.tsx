import { userEvent } from "@vitest/browser/context";
import { act, useEffect } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { captureEarlyClicks, replayEarlyClicks } from "./early-clicks";

/**
 * The bug: the server-rendered page paints its buttons before React attaches
 * a listener, and a click in that window reached no handler at all. This
 * reproduces the window for real — server HTML in the document, a real click
 * on it, and only then `hydrateRoot` — with the replay where root.tsx puts
 * it: an effect that runs once hydration has committed.
 */
function Page(props: { onClick: () => void; onPointerDown: () => void }) {
  useEffect(replayEarlyClicks, []);
  return (
    <div>
      <button type="button" onClick={props.onClick}>
        Send feedback
      </button>
      <button type="button" onPointerDown={props.onPointerDown}>
        Actions
      </button>
    </div>
  );
}

let root: Root | undefined;
afterEach(() => {
  root?.unmount();
  document.body.innerHTML = "";
});

it("hands a click that landed before hydration to the hydrated handler, once", async () => {
  const onClick = vi.fn();
  const onPointerDown = vi.fn();
  const container = document.createElement("div");
  container.innerHTML = renderToString(
    <Page onClick={() => {}} onPointerDown={() => {}} />
  );
  document.body.append(container);

  captureEarlyClicks();
  const [feedback, actions] = container.querySelectorAll("button");
  await userEvent.click(feedback!);
  await userEvent.click(actions!);
  expect(onClick).not.toHaveBeenCalled();

  await act(async () => {
    root = hydrateRoot(
      container,
      <Page onClick={onClick} onPointerDown={onPointerDown} />
    );
  });

  await expect.poll(() => onClick.mock.calls.length).toBe(1);
  // A Radix menu trigger opens on pointerdown, not click.
  expect(onPointerDown).toHaveBeenCalledTimes(1);

  // Hydrated: clicks now go straight to React, and are not replayed again.
  await userEvent.click(feedback!);
  expect(onClick).toHaveBeenCalledTimes(2);
});
