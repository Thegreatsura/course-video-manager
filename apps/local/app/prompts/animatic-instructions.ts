/**
 * The Video's Animatic, as a system-prompt section. How much weight it and
 * its comments carry is the source hierarchy's call; this section only says
 * how to read the block.
 */
export const getAnimaticSection = (animatic: string): string => {
  if (!animatic.trim()) return "";

  return `\n\n## Animatic\n\nThe following is the video's Animatic — the mock the author watched before filming. Each "Mockup N" is one planned moment: a still image that was to be on screen (not included here) and the line to be said over it. "Chapter:" lines are dividers grouping the moments below them. Mockup numbers are NOT transcript clip indices — never use one as a clipIndex. Lines starting "Comment:" are the author's own notes, each about the mockup or chapter above it. Use the Animatic as the source hierarchy says: the mockup lines are a plan the transcript confirms or overrules; a comment about the written output is an instruction to follow; a comment about the take is a plan; and no mockup line or comment is ever quoted as words said on camera:\n\n<animatic>\n${animatic}\n</animatic>`;
};
