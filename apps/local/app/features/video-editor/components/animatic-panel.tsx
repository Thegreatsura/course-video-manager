import { useMemo, useState } from "react";
import type { AnimaticLine } from "@/features/animatic/animatic-lines";
import { clipMockupFrameUrl } from "@/features/clip-mockups/clip-mockup-frame-url";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type ClipMockupLine = Extract<AnimaticLine, { type: "clip-mockup" }>;

/** A line's Clip Mockup Comments, as a margin note under it. */
function PanelComments({ comments }: { comments: readonly string[] }) {
  if (comments.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5 border-l-2 border-amber-400/70 pl-2 text-xs font-normal normal-case tracking-normal text-amber-700 dark:text-amber-300">
      {comments.map((body, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {body}
        </p>
      ))}
    </div>
  );
}

/**
 * The editor side slot's **Animatic** tab: this video's Clip Mockups read as
 * lines, one clip at a time, under their Clip Mockup Chapters — each with a
 * small thumbnail of its still, so you can check a filmed Clip against what
 * was planned for that moment.
 *
 * READ-ONLY on purpose — see `EditorSidePanel`. No drag, no line editor.
 *
 * Clicking a row opens its still large in a modal, to check what was
 * planned at full size. LEFT and RIGHT step to the previous/next Clip Mockup
 * and ESCAPE closes it. While it is open the editor's own keys do nothing:
 * its shortcuts already ignore a key from inside a dialog, and the modal stops
 * the arrows besides, so stepping through stills never moves the timeline.
 *
 * The number is the Clip Mockup's position, the same one the Animatic page
 * shows, so "number 14" means the same clip in both places.
 */
export function AnimaticPanel({ lines }: { lines: AnimaticLine[] }) {
  const clips = useMemo(
    () => lines.filter((l): l is ClipMockupLine => l.type === "clip-mockup"),
    [lines]
  );
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  return (
    <div className="overflow-y-auto flex-1 px-3 py-2">
      <StillPreview
        clips={clips}
        index={previewIndex}
        onIndexChange={setPreviewIndex}
      />
      {lines.map((line) =>
        line.type === "chapter" ? (
          <div
            key={line.id}
            className="mt-4 mb-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-1"
          >
            {line.name}
            <PanelComments comments={line.comments} />
          </div>
        ) : (
          <div
            key={line.id}
            // A div rather than a button: the editor's shortcuts ignore any
            // key whose target is a button, so a focused trigger would leave
            // the arrows dead once the modal closes.
            onClick={() => setPreviewIndex(line.position - 1)}
            className="flex cursor-zoom-in gap-2 py-2 border-b border-border/40 last:border-b-0 hover:bg-muted/50"
          >
            <span className="w-5 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-muted-foreground">
              {line.position}
            </span>
            <img
              src={clipMockupFrameUrl(line.id)}
              alt=""
              loading="lazy"
              className="h-12 aspect-video shrink-0 rounded-sm border bg-black object-contain"
              // A frame the disk does not have shows as an empty box, not a
              // broken-image glyph. The Animatic page is where a missing file
              // is reported.
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug">{line.line}</p>
              <PanelComments comments={line.comments} />
            </div>
          </div>
        )
      )}
    </div>
  );
}

/**
 * One Clip Mockup's still, as large as the window allows, with its line and
 * comments in a band of their own below it. The still's size comes from the
 * viewport alone, so a long line never makes it smaller.
 */
function StillPreview(props: {
  clips: readonly ClipMockupLine[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
}) {
  const { clips, index, onIndexChange } = props;
  const clip = index === null ? undefined : clips[index];

  return (
    <Dialog
      open={clip !== undefined}
      onOpenChange={(open) => {
        if (!open) onIndexChange(null);
      }}
    >
      {clip && index !== null && (
        <DialogContent
          aria-describedby={undefined}
          className="w-[min(94vw,calc(76vh*16/9))] max-w-none gap-3 p-4 sm:max-w-none"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            // Never let the arrows reach the editor's timeline.
            e.preventDefault();
            e.stopPropagation();
            const step = e.key === "ArrowLeft" ? -1 : 1;
            onIndexChange(
              Math.max(0, Math.min(index + step, clips.length - 1))
            );
          }}
          // Leave focus on the page, not on a trigger, so the editor's keys
          // work again the moment the modal closes.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="text-sm font-normal tabular-nums text-muted-foreground">
            Clip {clip.position} of {clips.length}
          </DialogTitle>
          <img
            src={clipMockupFrameUrl(clip.id)}
            alt={`Clip ${clip.position}`}
            className="aspect-video w-full rounded-md border bg-black object-contain"
          />
          <div className="max-h-[12vh] overflow-y-auto">
            <p className="text-base leading-snug">{clip.line}</p>
            <PanelComments comments={clip.comments} />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
