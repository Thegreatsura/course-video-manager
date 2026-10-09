import { DiagramComponentOperationsService } from "@cvm/core/services/db-diagram-component-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * Components, read-only: `cvm diagram component list` — every Component with
 * its shapes. Saving, renaming and deleting one stay in the playground.
 */
export const diagramComponentRoutes = (runtime: RemoteRuntime) =>
  new Hono().post(
    "/listComponentFragments",
    forward(
      runtime,
      DiagramComponentOperationsService,
      "listComponentFragments"
    )
  );
