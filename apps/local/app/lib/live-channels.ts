/**
 * The live channels on Matt's desk the browser connects to: the Stream Deck
 * forwarder hub (Stream Deck presses, teleprompter controls, browser
 * link-capture) and OBS. Every client reads its address from here, never from
 * a literal.
 *
 * A verify-cvm run overrides both (`VITE_STREAM_DECK_HUB_URL`,
 * `VITE_OBS_WEBSOCKET_URL`) with an address nothing listens on, so its editor
 * never hears Matt's real button presses — a press on a clone's editor acts
 * on the clone — and Matt's editor never hears it.
 */
export const STREAM_DECK_HUB_URL: string =
  import.meta.env.VITE_STREAM_DECK_HUB_URL || "ws://localhost:5172";

export const OBS_WEBSOCKET_URL: string =
  import.meta.env.VITE_OBS_WEBSOCKET_URL || "ws://localhost:4455";
