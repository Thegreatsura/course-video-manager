import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

// Guards the setup itself: if the app's CSS stops loading, layout assertions
// in other component tests would silently pass against unstyled markup.
test("the app's Tailwind stylesheet applies in browser tests", async () => {
  const screen = render(<p className="line-clamp-2 sticky">Styled</p>);
  const el = screen.getByText("Styled").element();
  const style = getComputedStyle(el);
  expect(style.position).toBe("sticky");
  expect(style.webkitLineClamp).toBe("2");
});
