import type { deepLinkFocusReducer } from "@/features/entity-links/deep-link-focus-reducer";
import type { TimelineItem } from "./clip-state-reducer";

/**
 * The timeline's Clips and Chapters as a link can name them: by database id,
 * under the frontend id the editor selects by. An item still only on the
 * frontend has no database id yet, so no link can name it. One on its way to
 * the archive is still listed, so the link says so rather than "missing".
 */
export const editorDeepLinkCandidates = (
  items: ReadonlyArray<TimelineItem>
): deepLinkFocusReducer.Candidate[] =>
  items.flatMap((item): deepLinkFocusReducer.Candidate[] => {
    if (item.type === "on-database") {
      return [
        {
          type: "clip",
          id: item.databaseId,
          key: item.frontendId,
          anchor: item.databaseId,
          archived: !!item.shouldArchive,
        },
      ];
    }
    if (item.type === "chapter-on-database") {
      return [
        {
          type: "chapter",
          id: item.databaseId,
          key: item.frontendId,
          anchor: item.databaseId,
        },
      ];
    }
    return [];
  });
