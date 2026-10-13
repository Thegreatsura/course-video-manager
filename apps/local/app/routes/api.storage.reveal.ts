import path from "node:path";
import { Data, Effect, Schema } from "effect";
import { assertUnderEffect } from "@/services/assert-under";
import { makeAction } from "@/services/route-action.server";
import { revealFileInExplorer } from "@/services/open-folder-service";
import {
  exportScratchDirectory,
  storageRootsConfig,
} from "@/services/storage-roots";

const RevealRequest = Schema.Struct({
  /** A Storage Root, or export scratch: where the per-bucket page found it. */
  location: Schema.String,
  /** Relative to `location`, as the per-bucket page lists it. */
  path: Schema.String,
});

class RevealRefusedError extends Data.TaggedError("RevealRefusedError")<{
  readonly message: string;
}> {}

/**
 * "Show in Explorer" on the per-bucket page (#2157): open Explorer with one
 * file selected. Only a file under a Storage Root or export scratch, named by
 * a plain relative path; it only opens a window.
 */
export const action = makeAction({
  input: "json",
  errors: { RevealRefusedError: 400, PathOutsideBaseDirError: 400 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(RevealRequest)(payload);
      const roots = yield* storageRootsConfig;
      const locations: string[] = [...roots, exportScratchDirectory()];
      if (!locations.includes(request.location)) {
        return yield* new RevealRefusedError({
          message: `${request.location} is not a Storage Root`,
        });
      }
      if (
        path.posix.isAbsolute(request.path) ||
        request.path.split("/").some((s) => s === "" || s === "." || s === "..")
      ) {
        return yield* new RevealRefusedError({
          message: `${request.path} is not a plain relative path`,
        });
      }
      const file = yield* assertUnderEffect(
        request.location,
        path.join(request.location, request.path)
      );
      yield* revealFileInExplorer(file);
      return { revealed: true };
    }),
});
