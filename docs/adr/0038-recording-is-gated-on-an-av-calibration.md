---
status: accepted
---

# Recording is gated on an AV Calibration

Decided by Matt on #2077 and #2082. Builds on [ADR 0034](0034-recording-runs-in-its-own-recorder-service.md).

Renamed from "Recording is gated on an Audio Calibration" (#2094), when the Audio Calibration became the AV Calibration (#2093). The decision is unchanged.

## Context

Matt's mic level drifted about 16 dB over one afternoon (2026-10-09) and nothing in CVM noticed: the silence detectors cut a session of takes badly before he found out. An **AV Calibration** measures the level and sets the silence threshold. A calibration that is optional, or can be snoozed, would be skipped on exactly the day it matters.

## Decision

1. **A Recorder starts only under a fresh AV Calibration.** That means the latest calibration that passes under _today's_ rules, less than 7 days old (exactly 7 days is expired), taken on the current audio input device. `calibrationValidity` in `av-calibration-constants.ts` is the one rule. It answers valid, or why not: none yet, expired on a date, or the device changed from A to B.
2. **"Passed under today's rules" is re-judged from the stored measurements.** A row counts only when it was stored as passed, its true peak was measured, and `judgeCalibration` still passes its speech loudness and peak today (`passesCurrentRules`). So a pass under the old -21 LUFS target, or one from before the peak check, does not open the gate, and any later rule change takes old passes out by itself. There is no rules version to remember to bump, and no migration.
3. **Scope: both Recorders and the Stream Deck.**
   - _CVM recorder:_ the record route refuses (`AVCalibrationRequiredError`) when there is none, or it has expired. Every `record` and `prepare-record` carries the calibration (protocol 7). The recorder service checks it again at the moment it starts, against its own clock and the mic it is about to record. It is the only one that knows that mic. So a Stream Deck Record is gated when it is pressed, even if the calibration expired after the recorder was prepared. Shorts record on the CVM recorder and are gated the same way.
   - _OBS:_ when OBS reports a recording started and the editor has no valid calibration for the mic its browser detector hears (its getUserMedia track's label), the OBS connector stops it at once and says why. This only works while an editor is connected to OBS; that limit is accepted.
   - _Editor:_ a banner on each Recorder's Record controls shows the reason and links to the AV Calibration page, before Record is pressed; the CVM recorder's Record is disabled while it shows. The AV Calibration page says when the last pass expires.
4. **It never stops a take that is running.** The gate is checked only when a recording starts. A take that runs past its calibration's expiry carries on to its end and is saved. Losing footage is worse than one take at an unchecked level.
5. **No skip, override or snooze.** The fix is always one click away, and it takes about a minute.
6. **CVM reads levels; it never writes them.** The gate refuses and explains. Matt sets the level by hand, on the Scarlett's knob or the Voicemeeter fader. CVM never changes a Windows, OBS or Voicemeeter setting.

## Consequences

- With no fresh calibration, nothing records. After a fresh install, or a week away, the first step of a filming day is an AV Calibration.
- The CVM recorder's mic is checked only by the recorder service, when recording starts. The editor's banner cannot know about a changed mic in advance; the refusal says so when Record is pressed.
- Each Recorder compares the device it actually hears. The CVM recorder compares the service's DirectShow mic. OBS compares the browser's mic label. Hardware behind Voicemeeter (the Scarlett) is invisible to CVM, so the 7-day expiry covers it.
- An app server older than protocol 7 sends no calibration, and the service refuses its Record and tells it to reload.
