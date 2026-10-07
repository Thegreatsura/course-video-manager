import { deepLinkAnchor } from "@/features/entity-links/use-deep-link-focus";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import type { Chapter } from "../clip-state-reducer";
import { ChapterDivider } from "./chapter-divider";
import { InsertionPointWithSession } from "./insertion-point-with-session";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { timelineItemMenuGroups } from "./timeline-item-menu";
import { getChapterPercentComplete } from "../video-editor-selectors";

/**
 * ChapterItem component displays a chapter divider with context menu
 * in the video editor timeline.
 */
export const ChapterItem = (props: {
  chapter: Chapter;
  isFirstItem: boolean;
  isLastItem: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onEditChapter: () => void;
  onAddChapterBefore: () => void;
  onAddChapterAfter: () => void;
}) => {
  // Use context selectors
  const isSelected = useContextSelector(VideoEditorContext, (ctx) =>
    ctx.selectedClipsSet.has(props.chapter.frontendId)
  );
  const insertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.insertionPoint
  );
  const selectedClipsSet = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.selectedClipsSet
  );
  const dispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.dispatch
  );
  const items = useContextSelector(VideoEditorContext, (ctx) => ctx.items);
  const currentClipId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentClipId
  );
  // ONLY A COLLAPSED CHAPTER WATCHES THE CLOCK. `currentTimeInClip` changes
  // several times a second, so an expanded Chapter — which draws no bar — reads
  // a constant instead and re-renders no more often than it did before.
  const currentTimeInClip = useContextSelector(VideoEditorContext, (ctx) =>
    props.isCollapsed ? ctx.currentTimeInClip : 0
  );
  const percentComplete = props.isCollapsed
    ? getChapterPercentComplete({
        items,
        chapterId: props.chapter.frontendId,
        currentClipId,
        currentTimeInClip,
      })
    : null;
  return (
    <div
      {...(props.chapter.type === "chapter-on-database" &&
        deepLinkAnchor(props.chapter.databaseId))}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ChapterDivider
            name={props.chapter.name}
            isSelected={isSelected}
            isCollapsed={props.isCollapsed}
            onToggleCollapse={props.onToggleCollapse}
            percentComplete={percentComplete}
            onClick={(e) => {
              // If already selected and clicked again (without modifiers),
              // play from the next clip after this section
              if (
                !e.ctrlKey &&
                !e.shiftKey &&
                selectedClipsSet.has(props.chapter.frontendId) &&
                selectedClipsSet.size === 1
              ) {
                dispatch({
                  type: "play-from-chapter",
                  chapterId: props.chapter.frontendId,
                });
                return;
              }
              dispatch({
                type: "click-clip",
                clipId: props.chapter.frontendId,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
              });
            }}
          />
        </ContextMenuTrigger>
        <ChapterMenuContent
          chapter={props.chapter}
          isFirstItem={props.isFirstItem}
          isLastItem={props.isLastItem}
          onEditChapter={props.onEditChapter}
          onAddChapterBefore={props.onAddChapterBefore}
          onAddChapterAfter={props.onAddChapterAfter}
        />
      </ContextMenu>
      {insertionPoint.type === "after-chapter" &&
        insertionPoint.frontendChapterId === props.chapter.frontendId && (
          <InsertionPointWithSession />
        )}
    </div>
  );
};

/**
 * A Chapter's right-click menu. Mounted only while open, so the editor state
 * it reads does not re-render every Chapter in the timeline.
 */
const ChapterMenuContent = (props: {
  chapter: Chapter;
  isFirstItem: boolean;
  isLastItem: boolean;
  onEditChapter: () => void;
  onAddChapterBefore: () => void;
  onAddChapterAfter: () => void;
}) => {
  const { chapter } = props;
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const dispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.dispatch
  );
  const hasSelection = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.selectedClipsSet.size > 0
  );
  const onSetInsertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onSetInsertionPoint
  );
  const onMoveClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onMoveClip
  );
  const setIsCreateVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsCreateVideoModalOpen
  );

  return (
    <EntityMenuContent
      menu="context"
      entity={
        chapter.type === "chapter-on-database"
          ? { type: "chapter", id: chapter.databaseId, videoId }
          : null
      }
      groups={timelineItemMenuGroups({
        onRename: props.onEditChapter,
        onInsert: (position) =>
          onSetInsertionPoint(position, chapter.frontendId),
        onAddChapter: (position) =>
          position === "before"
            ? props.onAddChapterBefore()
            : props.onAddChapterAfter(),
        onCreateVideoFromSelection: hasSelection
          ? () => setIsCreateVideoModalOpen(true)
          : undefined,
        move: {
          onMove: (direction) => onMoveClip(chapter.frontendId, direction),
          isFirstItem: props.isFirstItem,
          isLastItem: props.isLastItem,
        },
        delete: {
          confirms: false,
          shortcut: "Del",
          onSelect: () =>
            dispatch({ type: "delete-clip", clipId: chapter.frontendId }),
        },
      })}
    />
  );
};
