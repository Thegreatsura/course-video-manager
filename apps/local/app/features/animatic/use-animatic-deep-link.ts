import type { Dispatch, SetStateAction } from "react";
import { useDeepLinkFocus } from "@/features/entity-links/use-deep-link-focus";
import type { AnimaticChapterSection } from "./animatic-chapters";
import type { AnimaticCollapseState } from "./animatic-collapse";
import { useCommentsByParent } from "./animatic-comments";
import { sectionAtIndex } from "./animatic-progress";
import type { AnimaticSelection } from "./animatic-selection";
import type { AnimaticSegment } from "./animatic-timeline";

/**
 * A copied `?clip-mockup=`, `?clip-mockup-chapter=` or `?clip-mockup-comment=`
 * link focuses its item. A Clip Mockup is selected, with its Chapter unfolded so
 * the row is on screen; a Chapter is unfolded; a comment focuses the Clip
 * Mockup or Chapter it was left on, since its thread lives in a popover there.
 */
export function useAnimaticDeepLink(props: {
  segments: ReadonlyArray<AnimaticSegment>;
  sections: ReadonlyArray<AnimaticChapterSection>;
  setSelection: Dispatch<SetStateAction<AnimaticSelection>>;
  setCollapsed: Dispatch<SetStateAction<AnimaticCollapseState>>;
}) {
  const commentsByParent = useCommentsByParent();
  const unfold = (chapterId: string) =>
    props.setCollapsed((prev) => ({ ...prev, [chapterId]: false }));

  useDeepLinkFocus({
    types: ["clip-mockup", "clip-mockup-chapter", "clip-mockup-comment"],
    candidates: [
      ...props.segments.map((s) => ({
        type: "clip-mockup" as const,
        id: s.mockup.id,
        key: s.mockup.id,
      })),
      ...props.sections.map((s) => ({
        type: "clip-mockup-chapter" as const,
        id: s.chapter.id,
        key: s.chapter.id,
      })),
      ...[...commentsByParent].flatMap(([parentId, comments]) =>
        comments.map((c) => ({
          type: "clip-mockup-comment" as const,
          id: c.id,
          key: parentId,
        }))
      ),
    ],
    onFocus: ({ key }) => {
      const index = props.segments.findIndex((s) => s.mockup.id === key);
      if (index < 0) return unfold(key);
      props.setSelection(index);
      const section = sectionAtIndex({
        sections: props.sections,
        activeIndex: index,
      });
      if (section) unfold(section.chapter.id);
    },
  });
}
