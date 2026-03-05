import { InsertionPointIndicator, BeatIndicator } from "./timeline-indicators";
import { ClipItem } from "./clip-item";
import { ClipSectionItem } from "./clip-section-item";
import { PreRecordingChecklist } from "./pre-recording-checklist";
import { InlineSuggestion } from "./inline-suggestion";
import { RecordingSessionPanels } from "./recording-session-panel";
import { isClipSection } from "../clip-utils";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";

/**
 * ClipTimeline component displays the main timeline of clips and clip sections.
 *
 * Handles rendering:
 * - Pre-recording checklist (when no clips exist)
 * - Insertion point indicators (start/end/after-clip positions)
 * - Clip sections (with full interactivity)
 * - Clips (with full interactivity)
 * - Beat indicators between clips
 */
export const ClipTimeline = () => {
  // Use context selectors for state needed by this component
  const items = useContextSelector(VideoEditorContext, (ctx) => ctx.items);
  const clips = useContextSelector(VideoEditorContext, (ctx) => ctx.clips);
  const insertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.insertionPoint
  );
  const clipComputedProps = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.clipComputedProps
  );
  const generateDefaultClipSectionName = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.generateDefaultClipSectionName
  );
  const onAddIntroSection = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddIntroSection
  );
  const onEditSection = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onEditSection
  );
  const onAddSectionBefore = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddSectionBefore
  );
  const onAddSectionAfter = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddSectionAfter
  );
  return (
    <div className="lg:flex-1 flex gap-2 h-full order-2 lg:order-1 overflow-y-auto">
      <div className="grid gap-4 w-full p-2">
        {clips.length === 0 && (
          <PreRecordingChecklist onAddIntroSection={onAddIntroSection} />
        )}

        {items.length > 0 && (
          <>
            {insertionPoint.type === "start" && <InsertionPointIndicator />}
            {items.map((item, itemIndex) => {
              const isFirstItem = itemIndex === 0;
              const isLastItem = itemIndex === items.length - 1;

              // Render clip section divider
              if (isClipSection(item)) {
                return (
                  <ClipSectionItem
                    key={item.frontendId}
                    section={item}
                    isFirstItem={isFirstItem}
                    isLastItem={isLastItem}
                    onEditSection={() => {
                      onEditSection(item.frontendId, item.name);
                    }}
                    onAddSectionBefore={() => {
                      onAddSectionBefore(
                        item.frontendId,
                        generateDefaultClipSectionName()
                      );
                    }}
                    onAddSectionAfter={() => {
                      onAddSectionAfter(
                        item.frontendId,
                        generateDefaultClipSectionName()
                      );
                    }}
                  />
                );
              }

              // Render clip
              const clip = item;
              const computedProps = clipComputedProps.get(clip.frontendId);
              const timecode = computedProps?.timecode ?? "";
              const nextLevenshtein = computedProps?.nextLevenshtein ?? 0;

              return (
                <div key={clip.frontendId}>
                  <ClipItem
                    clip={clip}
                    isFirstItem={isFirstItem}
                    isLastItem={isLastItem}
                    timecode={timecode}
                    nextLevenshtein={nextLevenshtein}
                    onAddSectionBefore={() => {
                      onAddSectionBefore(
                        clip.frontendId,
                        generateDefaultClipSectionName()
                      );
                    }}
                    onAddSectionAfter={() => {
                      onAddSectionAfter(
                        clip.frontendId,
                        generateDefaultClipSectionName()
                      );
                    }}
                  />
                  {/* Beat indicator dots below clip */}
                  {clip.beatType === "long" && <BeatIndicator />}
                  {insertionPoint.type === "after-clip" &&
                    insertionPoint.frontendClipId === clip.frontendId && (
                      <InsertionPointIndicator />
                    )}
                </div>
              );
            })}

            {/* Fallback: show insertion point when it references a clip not in the filtered timeline (e.g., unpaired optimistic clip) */}
            {insertionPoint.type === "after-clip" &&
              !items.some(
                (item) => item.frontendId === insertionPoint.frontendClipId
              ) && <InsertionPointIndicator />}

            {insertionPoint.type === "end" && <InsertionPointIndicator />}
          </>
        )}

        {/* Inline suggestion display at the bottom of the timeline */}
        <InlineSuggestion />

        {/* Recording session panels below the timeline */}
        <RecordingSessionPanels />
      </div>
    </div>
  );
};
