import type { Lesson } from "./course-view-types";

export function buildSectionTranscript(sectionPath: string, lessons: Lesson[]) {
  const realLessons = lessons.filter((l) => l.fsStatus !== "ghost");
  const lines: string[] = [`<section title="${escapeAttr(sectionPath)}">`];
  for (const lesson of realLessons) {
    lines.push(`  <lesson title="${escapeAttr(lesson.path)}">`);
    if (lesson.videos.length === 0) {
      lines.push("    (no videos)");
      lines.push("  </lesson>");
      continue;
    }
    for (const video of lesson.videos) {
      lines.push(`    <video title="${escapeAttr(video.path)}">`);
      if (video.clips.length === 0) {
        lines.push("      (no clips)");
        lines.push("    </video>");
        continue;
      }
      const transcript = video.clips
        .map((c) => c.text)
        .filter(Boolean)
        .join(" ");
      lines.push(`      ${transcript || "(no transcript)"}`);
      lines.push("    </video>");
    }
    lines.push("  </lesson>");
  }
  lines.push("</section>");
  return lines.join("\n");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
