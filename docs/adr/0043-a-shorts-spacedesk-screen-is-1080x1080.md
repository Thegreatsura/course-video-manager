---
status: accepted
---

# A Short's Spacedesk screen is 1080x1080

Decided by Matt on 2026-10-13 (#2156). Supersedes the display's shape in [ADR 0034](0034-recording-runs-in-its-own-recorder-service.md), decision 9. The rest of decision 9 stands.

## Context

A **Short** records the Spacedesk virtual display as its screen. ADR 0034 made that display landscape 1920x1080, and the Short layout showed its left 1080x1080 square 1:1 above the camera band, as OBS's TikTok profile did.

When he films a Short, Matt puts windows full screen on the Spacedesk display. At 1920x1080, everything right of the left square is outside the Short: most of a full-screen website, for example. What Matt sees on that screen is not what the Short shows.

## Decision

1. **The Spacedesk display is 1080x1080, and a Short draws all of it.** The whole screen is exactly what the Short shows. Matt sets the size himself on the PC; agents never change Spacedesk, display or Windows settings.
2. **The Short layout draws the screen's left square** (`crop: "left-square"` in `scene-layout`): a square as tall as the screen, from its top-left corner. That is all of a 1080x1080 screen, drawn 1:1 at the top of the 1080x1920 frame, with no crop. The output frame and the camera band are unchanged. The Short layout version stays 3: a 1920x1080 screen draws exactly as before, and no square screen was recorded before this.
3. **The recorder accepts a square or a 16:9 Spacedesk display, during the switch.** A 1920x1080 display still records, and the Short still shows its left square. Any other shape is unavailable, with a message to set Spacedesk to 1080x1080. Accepting 16:9 is temporary: remove it once Matt has switched.
4. **The screen preview keeps the screen's shape:** 540 tall, as wide as the shape (540x540 square, 960x540 for 16:9). A fixed 960x540 would stretch a square screen.
5. **The wake asks for 1080x1080.** The handshake's client and custom resolutions are both 1080x1080 (`app/spacedesk-wake.ts`). It is a request: the recorder checks the size the display actually has.
6. **A Short's diagram centres in the full viewport on a square screen.** `getCentringInsets` reserves everything right of the left 1080 px, which on a 1080x1080 window is nothing: there is only the padding, and no face-cam strip.

## Consequences

- Landscape is unchanged: its layout, its pinned filtergraph (`landscape-pin.test.ts`), the DELL's recording and its 960x540 preview.
- The 1080x1080 size is set on the PC, not in CVM. Spacedesk's manual does not list a square resolution among its custom resolutions, so it is unproven until Matt sets it and the recorder reports the display ready.
