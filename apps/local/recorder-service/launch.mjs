#!/usr/bin/env node
/**
 * What `ensure-recorder-service.ts` spawns, detached, to start the recorder
 * service. A plain Node file, as the Clip Mockup daemon's `daemon.mjs` is, so
 * it can load the TypeScript through tsx from this checkout. This is the only
 * place the service calls process.exit.
 */
const { tsImport } = await import("tsx/esm/api");
const { runRecorderService } = await tsImport(
  "./run-recorder-service.ts",
  import.meta.url
);

try {
  await runRecorderService();
  process.exit(0);
} catch (error) {
  console.error("recorder service failed to start:", error);
  process.exit(1);
}
