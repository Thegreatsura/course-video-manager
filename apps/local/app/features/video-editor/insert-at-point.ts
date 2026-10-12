import type {
  FrontendInsertionPoint,
  TimelineItem,
} from "./clip-state-reducer.types";

const afterItem = (item: TimelineItem): FrontendInsertionPoint => {
  if (
    item.type === "chapter-on-database" ||
    item.type === "chapter-optimistically-added"
  ) {
    return { type: "after-chapter", frontendChapterId: item.frontendId };
  }
  return { type: "after-clip", frontendClipId: item.frontendId };
};

export const insertAtPoint = (
  items: TimelineItem[],
  newItem: TimelineItem,
  insertionPoint: FrontendInsertionPoint
): { items: TimelineItem[]; insertionPoint: FrontendInsertionPoint } => {
  if (insertionPoint.type === "end") {
    return {
      items: [...items, newItem],
      insertionPoint: { type: "end" },
    };
  }

  if (insertionPoint.type === "start") {
    return {
      items: [newItem, ...items],
      insertionPoint: afterItem(newItem),
    };
  }

  const targetId =
    insertionPoint.type === "after-clip"
      ? insertionPoint.frontendClipId
      : insertionPoint.frontendChapterId;

  const targetIndex = items.findIndex((item) => item.frontendId === targetId);

  if (targetIndex === -1) {
    throw new Error(`Target item not found when inserting after: ${targetId}`);
  }

  return {
    items: [
      ...items.slice(0, targetIndex + 1),
      newItem,
      ...items.slice(targetIndex + 1),
    ],
    insertionPoint: afterItem(newItem),
  };
};

/**
 * Returns the default insertion point: below the first section that has no
 * clips after it (before the next section or end of list). Falls back to "end".
 */
export function defaultInsertionPoint(
  items: TimelineItem[]
): FrontendInsertionPoint {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (
      item.type === "chapter-on-database" ||
      item.type === "chapter-optimistically-added"
    ) {
      const nextItem = items[i + 1];
      // Section is "empty" if the next item is another section or there's nothing after it
      const isEmpty =
        !nextItem ||
        nextItem.type === "chapter-on-database" ||
        nextItem.type === "chapter-optimistically-added";
      if (isEmpty) {
        return {
          type: "after-chapter",
          frontendChapterId: item.frontendId,
        };
      }
    }
  }
  return { type: "end" };
}
