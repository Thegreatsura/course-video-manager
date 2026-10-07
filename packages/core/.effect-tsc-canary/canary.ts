// A deliberate floatingEffect. scripts/check-effect-tsc.ts runs `tsc` on this
// file and fails unless `tsc` reports it, which proves `tsc` is the binary
// `effect-tsgo patch` installed. Do not fix it.
import { Effect } from "effect";

export const canary = Effect.gen(function* () {
  Effect.log("dropped");
});
