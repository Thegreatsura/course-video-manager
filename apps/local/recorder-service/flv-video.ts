/**
 * The H.264 video in an FLV stream, tag by tag, as ffmpeg's flv muxer writes
 * it (`previewOutput`, #2192): first the AVC sequence header (the avcC
 * record a decoder is configured with), then one tag per frame, its NAL
 * units length-prefixed (AVCC). Every tag carries its own length, so a
 * frame is handed on the moment its last byte is in.
 *
 * A new FLV header (ffmpeg reconnecting) starts the parse again.
 */

export type FlvVideo =
  | { kind: "config"; avcC: Buffer }
  | { kind: "frame"; key: boolean; data: Buffer };

const FLV_HEADER = 9;
const PREVIOUS_TAG_SIZE = 4;
const TAG_HEADER = 11;
const VIDEO_TAG = 9;
const AVC_CODEC = 7;
/** Frame type (high nibble) 1 is a keyframe. */
const KEY_FRAME = 1;
/** After the video tag's first byte: AVCPacketType (1) and composition time (3). */
const AVC_HEADER = 5;

export const flvVideoParser = (onVideo: (video: FlvVideo) => void) => {
  let buffer: Buffer = Buffer.alloc(0);
  let headerRead = false;
  return (chunk: Buffer) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    for (;;) {
      if (!headerRead) {
        if (buffer.length < FLV_HEADER + PREVIOUS_TAG_SIZE) return;
        if (buffer.toString("latin1", 0, 3) !== "FLV") {
          // Not at a header: skip to the next one, if any came.
          const next = buffer.indexOf("FLV", 1, "latin1");
          buffer =
            next < 0
              ? buffer.subarray(buffer.length - 2)
              : buffer.subarray(next);
          if (next < 0) return;
          continue;
        }
        buffer = buffer.subarray(buffer.readUInt32BE(5) + PREVIOUS_TAG_SIZE);
        headerRead = true;
        continue;
      }
      if (buffer.length >= 3 && buffer.toString("latin1", 0, 3) === "FLV") {
        headerRead = false;
        continue;
      }
      if (buffer.length < TAG_HEADER) return;
      const type = buffer.readUInt8(0) & 0x1f;
      const size = buffer.readUIntBE(1, 3);
      const end = TAG_HEADER + size + PREVIOUS_TAG_SIZE;
      if (buffer.length < end) return;
      const body = buffer.subarray(TAG_HEADER, TAG_HEADER + size);
      buffer = buffer.subarray(end);
      if (type !== VIDEO_TAG || body.length < AVC_HEADER) continue;
      if ((body.readUInt8(0) & 0x0f) !== AVC_CODEC) continue;
      const payload = Buffer.from(body.subarray(AVC_HEADER));
      if (body.readUInt8(1) === 0) onVideo({ kind: "config", avcC: payload });
      else if (body.readUInt8(1) === 1 && payload.length > 0)
        onVideo({
          kind: "frame",
          key: body.readUInt8(0) >> 4 === KEY_FRAME,
          data: payload,
        });
    }
  };
};
