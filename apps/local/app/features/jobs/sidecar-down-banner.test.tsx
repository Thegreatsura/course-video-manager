import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidecarDownBanner } from "./sidecar-down-banner";

describe("SidecarDownBanner", () => {
  it("says, as an alert, that background jobs are stopped while the sidecar is down", () => {
    const html = renderToStaticMarkup(
      <SidecarDownBanner
        sidecar="not-running"
        message="nothing answers on .data/sidecar.sock"
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("the sidecar is not running");
    expect(html).toContain('title="nothing answers on .data/sidecar.sock"');
  });

  it("is not there while the sidecar runs, or before the stream has said", () => {
    for (const sidecar of ["running", "unknown"] as const) {
      expect(
        renderToStaticMarkup(
          <SidecarDownBanner sidecar={sidecar} message={null} />
        )
      ).toBe("");
    }
  });
});
