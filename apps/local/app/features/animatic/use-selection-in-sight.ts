import { useEffect, type RefObject } from "react";
import type { AnimaticChapterSection } from "./animatic-chapters";
import { sectionAtIndex } from "./animatic-progress";

/**
 * Keep the selected row in sight. While the author has made no choice of his
 * own the selection follows the playhead, so this is also what makes the list
 * walk itself down as the Animatic plays.
 *
 * A FOLD IS NOT OPENED TO DO IT. The Animatic plays straight through a folded
 * Chapter and leaves it folded: the author folded a settled Playthrough away
 * and having it spring open at the next Clip Mockup undid that with every
 * boundary. What is brought into sight then is the DIVIDER, which is all
 * there is on screen for those rows — and which carries the fill bar saying
 * they are playing.
 */
export function useSelectionInSight(props: {
  listRef: RefObject<HTMLOListElement | null>;
  sectionsRef: RefObject<readonly AnimaticChapterSection[]>;
  selectedIndex: number;
}) {
  const { listRef, sectionsRef, selectedIndex } = props;
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector(`[data-animatic-index="${selectedIndex}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      return;
    }
    const section = sectionAtIndex({
      sections: sectionsRef.current,
      activeIndex: selectedIndex,
    });
    if (!section) return;
    list
      .querySelector(`[data-animatic-chapter="${section.chapter.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
}
