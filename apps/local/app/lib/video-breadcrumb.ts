/**
 * The "section/lesson/video" breadcrumb shown on the video editor page and in
 * the Article Writer modal. A standalone video has no section or lesson, so it
 * is just the video title.
 */
export function formatVideoBreadcrumb(args: {
  isStandalone: boolean;
  sectionPath: string | null;
  lessonPath: string | null;
  videoTitle: string;
}): string {
  if (args.isStandalone) return args.videoTitle;
  return `${args.sectionPath}/${args.lessonPath}/${args.videoTitle}`;
}
