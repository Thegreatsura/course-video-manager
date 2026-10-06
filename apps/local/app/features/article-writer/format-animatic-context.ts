import type { AnimaticLine } from "@/features/animatic/animatic-lines";

/**
 * A Video's Animatic as the writer reads it: every Clip Mockup's spoken line
 * under the Clip Mockup Chapter it sits in, with the author's Clip Mockup
 * Comments filed under the line or divider each one is about.
 *
 * Lines are labelled "Mockup N", never "Clip N": the transcript numbers its
 * filmed Clips `[N]` and the writer cites those numbers (ChooseScreenshot's
 * clipIndex), so the two counts must not read as one. N is the number the
 * Animatic page shows, so "number 14" means one moment everywhere.
 *
 * Text only. The stills stay on disk: an Animatic runs to dozens of frames,
 * which would cost far more tokens than the lines that describe them.
 */
export function formatAnimaticContext(lines: readonly AnimaticLine[]): string {
  return lines
    .map((line) => {
      const header =
        line.type === "chapter"
          ? `Chapter: ${line.name}`
          : `Mockup ${line.position}: "${line.line}"`;
      const comments = line.comments.map(
        (body) => `  Comment: ${body.split("\n").join("\n    ")}`
      );
      return [header, ...comments].join("\n");
    })
    .join("\n");
}
