import { Context, Layer } from "effect";

/**
 * Proof that the code asking for it runs in the **Sidecar**
 * (docs/plans/background-jobs-sidecar.md, section 3.7, guard 2).
 *
 * Work that has moved into a Job asks for this tag, so its effect needs it
 * to run. Only the sidecar's layer provides it (`sidecar/run-sidecar.ts`);
 * the app server's `layerLive` does not. A route that reaches such work —
 * `makeAction` / `makeLoader` constrain a route's requirements to
 * `LayerLive` — fails to compile, and the work goes back through
 * `enqueueJob` instead. Tests provide `SidecarContextTest`.
 */
export class SidecarContext extends Context.Tag("SidecarContext")<
  SidecarContext,
  { readonly runsIn: "sidecar" | "test" }
>() {}

export const SidecarContextLive = Layer.succeed(SidecarContext, {
  runsIn: "sidecar",
});

export const SidecarContextTest = Layer.succeed(SidecarContext, {
  runsIn: "test",
});
