/**
 * FLV as ffmpeg's flv muxer writes a preview (`previewOutput`): a header,
 * then video tags. Payloads are opaque here: the service relays them
 * without decoding.
 */

export const flvHeader = () =>
  Buffer.concat([
    Buffer.from("FLV"),
    Buffer.from([1, 0x01, 0, 0, 0, 9]),
    Buffer.alloc(4),
  ]);

/** One video tag: the avcC config, or a frame. */
export const flvVideoTag = (
  video: { config: Buffer } | { key: boolean; data: Buffer }
) => {
  const body = Buffer.concat([
    Buffer.from(
      "config" in video
        ? [0x17, 0, 0, 0, 0]
        : [video.key ? 0x17 : 0x27, 1, 0, 0, 0]
    ),
    "config" in video ? video.config : video.data,
  ]);
  const header = Buffer.alloc(11);
  header.writeUInt8(9, 0);
  header.writeUIntBE(body.length, 1, 3);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(11 + body.length);
  return Buffer.concat([header, body, size]);
};

/** A preview response's chunks (`PREVIEW_CHUNK`), from its bytes so far. */
export const previewChunks = (bytes: Buffer) => {
  const chunks: { kind: number; data: Buffer }[] = [];
  let at = 0;
  while (bytes.length - at >= 5) {
    const length = bytes.readUInt32BE(at + 1);
    if (bytes.length - at < 5 + length) break;
    chunks.push({
      kind: bytes.readUInt8(at),
      data: bytes.subarray(at + 5, at + 5 + length),
    });
    at += 5 + length;
  }
  return chunks;
};
