import { describe, expectTypeOf, it } from "vitest";
import { Effect } from "effect";
import type { LayerLive } from "./layer.server";
import { RenderVerticalVideoService } from "./render-vertical-video-service";
import type { SidecarContext } from "./sidecar-context";

// The runtime guard of docs/plans/background-jobs-sidecar.md, section 3.7:
// work that has moved into a Job needs `SidecarContext`, which the app
// server's `layerLive` does not provide. `makeAction` / `makeLoader` and
// `runtimeLive` accept only what `LayerLive` provides, so a route that reaches
// this work fails to compile. These are type checks: `pnpm typecheck` fails
// them, not the test run.
describe("SidecarContext", () => {
  it("a vertical render needs the Sidecar: layerLive cannot run it", () => {
    const render = Effect.flatMap(RenderVerticalVideoService, (service) =>
      service.renderVerticalVideo({ videoId: "a-video" })
    );
    type Missing = Exclude<Effect.Effect.Context<typeof render>, LayerLive>;
    expectTypeOf<Missing>().toEqualTypeOf<SidecarContext>();
  });
});
