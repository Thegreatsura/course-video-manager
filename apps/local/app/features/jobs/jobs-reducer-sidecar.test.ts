import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { createInitialJobsState, jobsReducer } from "./jobs-reducer";

const newTester = () =>
  new ReducerTester(jobsReducer, createInitialJobsState());

describe("what the tab knows of the sidecar", () => {
  it("is not running when the proxy finds nothing on the socket", () => {
    const state = newTester()
      .send({ type: "sidecar-unavailable", message: "nothing on the socket" })
      .getState();
    expect(state).toMatchObject({
      sidecar: "not-running",
      sidecarMessage: "nothing on the socket",
    });
  });

  it("is running again once the sidecar answers, even on a reconnect that replays instead of sending a snapshot", () => {
    // A restarted sidecar: the tab reconnects with its Last-Event-ID, so the
    // sidecar replays what it missed — no snapshot ever comes.
    const state = newTester()
      .send({ type: "sidecar-unavailable", message: "nothing on the socket" })
      .send({ type: "sidecar-available" })
      .getState();
    expect(state).toMatchObject({ sidecar: "running", sidecarMessage: null });
  });
});
