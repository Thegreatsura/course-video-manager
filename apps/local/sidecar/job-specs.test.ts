import { describe, expect, it } from "vitest";
import { JOB_KINDS } from "./job-kinds";
import { JOB_KIND_SPECS } from "./job-specs";

// The app server enqueues and retries against JOB_KIND_SPECS, the Sidecar
// runs JOB_KINDS. If they disagreed, a route would put a Job in the wrong
// lane, or give a post a second attempt.
describe("JOB_KIND_SPECS", () => {
  it("names exactly the kinds the Sidecar runs", () => {
    expect(Object.keys(JOB_KIND_SPECS).sort()).toEqual(
      Object.keys(JOB_KINDS).sort()
    );
  });

  it("gives each kind the Sidecar's own lane, attempts and flags", () => {
    const policyOf = (kind: {
      lane: string;
      maxAttempts: number;
      posting?: boolean;
      neverRequeued?: boolean;
    }) => ({
      lane: kind.lane,
      maxAttempts: kind.maxAttempts,
      posting: kind.posting === true,
      neverRequeued: kind.neverRequeued === true,
    });
    for (const [name, kind] of Object.entries(JOB_KINDS)) {
      const spec = JOB_KIND_SPECS[name as keyof typeof JOB_KIND_SPECS];
      expect({ name, ...policyOf(spec) }).toEqual({
        name,
        ...policyOf(kind),
      });
    }
  });
});
