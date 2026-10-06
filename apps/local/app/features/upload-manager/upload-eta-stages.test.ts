import { describe, expect, it } from "vitest";
import { AUTOFILL_CONCURRENCY } from "@/services/autofill-service";
import { MAX_CONCURRENT_EXPORTS } from "@/services/course-publish-export-events";
import { DEFAULT_UPLOAD_CONCURRENCY } from "@/services/dropbox-upload-config";
import {
  AUTOFILL_POOL_CONCURRENCY,
  EXPORT_POOL_CONCURRENCY,
  UPLOAD_POOL_CONCURRENCY,
} from "./upload-eta-stages";

// The ETA replays each runner's pool on the client, so its idea of how many
// jobs run at once must be the runner's own.
describe("pool sizes the ETA assumes", () => {
  it("match the runners'", () => {
    expect(EXPORT_POOL_CONCURRENCY).toBe(MAX_CONCURRENT_EXPORTS);
    expect(UPLOAD_POOL_CONCURRENCY).toBe(DEFAULT_UPLOAD_CONCURRENCY);
    expect(AUTOFILL_POOL_CONCURRENCY).toBe(AUTOFILL_CONCURRENCY);
  });
});
