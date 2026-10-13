import { describe, expect, it } from "vitest";
import {
  CALIBRATION_REFUSAL_PREFIX,
  CALIBRATION_VALIDITY_MS,
  type LastPassedCalibration,
} from "../app/av-calibration-constants";
import {
  CALIBRATION,
  clock,
  connect,
  start,
  T0_MS,
  tmp,
} from "./test-utils/service-harness";

/**
 * THE GATE (ADR 0038), where it bites: the recorder service refuses to start
 * a Recording Session, from the editor or the Stream Deck, without a fresh
 * AV Calibration on the camera + mic pair it records. It never stops one running.
 */

const openRecorder = async () => {
  const s = await start();
  const app = await connect(s.port);
  const deck = await connect(s.port);
  await app.next("hello");
  app.send({ type: "open", videoId: "video-1" });
  await app.camera("live");
  return { app, deck };
};

describe("the AV Calibration gate on the recorder service", () => {
  it.each<[string, LastPassedCalibration | null, string]>([
    ["none has passed", null, "none has passed"],
    [
      "it is exactly 7 days old",
      { ...CALIBRATION, createdAtMs: T0_MS - CALIBRATION_VALIDITY_MS },
      "expired on",
    ],
    [
      "it was taken on another mic",
      { ...CALIBRATION, recorderMic: "Scarlett Solo USB" },
      'changed from "Scarlett Solo USB"',
    ],
    [
      "it was taken on another camera",
      { ...CALIBRATION, cameraDevice: "Elgato Facecam" },
      'camera changed from "Elgato Facecam" to "Cam Link 4K"',
    ],
  ])(
    "refuses Record and a Stream Deck Record when %s",
    async (_, calibration, why) => {
      const { app, deck } = await openRecorder();
      const folder = tmp();

      app.send({ type: "record", silenceLength: "short", folder, calibration });
      const refused = await app.next("refused");
      expect(refused.message).toContain(CALIBRATION_REFUSAL_PREFIX);
      expect(refused.message).toContain(why);

      app.send({
        type: "prepare-record",
        videoId: "video-1",
        silenceLength: "short",
        folder,
        calibration,
      });
      deck.send({ type: "stream-deck", press: { action: "record" } });
      const ignored = await app.next("stream-deck-ignored");
      expect(ignored.message).toContain(why);
      expect(app.received.some((m) => m.type === "recording-started")).toBe(
        false
      );
    }
  );

  it("checks only at the start: a take carries on past its calibration's expiry", async () => {
    const { app, deck } = await openRecorder();
    app.send({
      type: "prepare-record",
      videoId: "video-1",
      silenceLength: "short",
      folder: tmp(),
      calibration: CALIBRATION,
    });
    deck.send({ type: "stream-deck", press: { action: "record" } });
    await app.next("recording-started");

    clock.ms = CALIBRATION.createdAtMs + CALIBRATION_VALIDITY_MS + 60_000;
    deck.send({ type: "stream-deck", press: { action: "stop" } });
    expect(await app.next("recording-stopped")).toMatchObject({
      reason: "requested",
    });

    // The same prepared Record, now expired, is refused at the press.
    await app.camera("live");
    deck.send({ type: "stream-deck", press: { action: "record" } });
    expect((await app.next("stream-deck-ignored")).message).toContain(
      "expired on"
    );
  });
});
