export const getTranscriptSection = (
  transcript: string,
  preamble = "Here is the transcript of the video:"
): string => {
  if (!transcript) return "";

  return `${preamble}

<transcript>
${transcript}
</transcript>

Some clips are annotated with a «on screen: …» marker directly after their [N] index. This means those web pages were visible on screen during that part of the video. Treat them as context, not narration — do not read the marker out as prose. Where it genuinely helps the reader, you may link to those URLs at the relevant point. Each page is annotated only once, at its first appearance.

Some clips are annotated with a «diagram "Name": …» marker directly after their [N] index. This is the text written on the diagram that was on screen during that clip, flattened into one line — use it to understand what the diagram showed and to get its labels right. It is not narration, so never quote it as words said on camera. A diagram's text is repeated only when it changes.

`;
};
