import { MessageSquare, MessageSquarePlus, MoreHorizontal } from "lucide-react";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFetcher, useParams } from "react-router";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { groupCommentsByParent } from "./animatic-lines";
import type {
  ClipMockupCommentEvent,
  ClipMockupCommentWriteResult,
} from "@/routes/api.clip-mockup-comments";

/**
 * Clip Mockup Comments in the Animatic's sidebar — the author's notes on one
 * moment or one Chapter, kept for the filming day, where the teleprompter
 * shows them under the line.
 *
 * LIKE A COMMENT IN A GOOGLE DOC. A row or a divider with comments carries an
 * amber badge with their count; one without shows a quiet "add" icon on hover
 * only. Either opens the thread in a popover, where a comment is added, edited
 * and deleted. A comment has no author: the CVM has no users.
 *
 * RIGHT-CLICK IS A SECOND DOOR. Anywhere the Animatic shows a Clip Mockup —
 * its sidebar row, its frame on the stage — `AnimaticCommentContextMenu`
 * answers a right-click with a menu whose item opens that same thread.
 *
 * KEPT APART FROM THE ROWS. The page hands comments down through
 * `AnimaticCommentsProvider`, never folded into the Clip Mockups or Chapters,
 * so a new comment can never change the rows `useStableMockups` holds and so
 * can never remount the Player mid-watch.
 */

export interface AnimaticComment {
  readonly id: string;
  readonly clipMockupId: string | null;
  readonly clipMockupChapterId: string | null;
  readonly body: string;
}

export type AnimaticCommentTarget = Extract<
  ClipMockupCommentEvent,
  { type: "create" }
>["target"];

const NO_COMMENTS: readonly AnimaticComment[] = [];

const AnimaticCommentsContext = createContext<
  ReadonlyMap<string, readonly AnimaticComment[]>
>(new Map());

/** Every comment of the Video, for the threads anywhere below it. */
export function AnimaticCommentsProvider(props: {
  readonly comments: readonly AnimaticComment[];
  readonly children: ReactNode;
}) {
  const byParent = useMemo(
    () => groupCommentsByParent(props.comments),
    [props.comments]
  );
  return (
    <AnimaticCommentsContext.Provider value={byParent}>
      {props.children}
    </AnimaticCommentsContext.Provider>
  );
}

/** Every comment of the Video, keyed by the Clip Mockup or Chapter it is on. */
export function useCommentsByParent() {
  return useContext(AnimaticCommentsContext);
}

function useCommentsOn(target: AnimaticCommentTarget) {
  return useContext(AnimaticCommentsContext).get(target.id) ?? NO_COMMENTS;
}

/**
 * A right-click menu over anything that shows a Clip Mockup. Its one item
 * opens the Clip Mockup's comment thread, which the caller holds open through
 * `AnimaticCommentThread`'s `open` and `onOpenChange`.
 */
export function AnimaticCommentContextMenu(props: {
  readonly target: AnimaticCommentTarget;
  readonly onComment: () => void;
  /** Called as the menu opens and closes — the stage pauses the Player here. */
  readonly onOpenChange?: (open: boolean) => void;
  /** No menu at all — the browser's own answers the right-click. */
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  const comments = useCommentsOn(props.target);
  const videoId = useVideoIdParam();
  const count = comments.length;
  return (
    <ContextMenu onOpenChange={props.onOpenChange}>
      <ContextMenuTrigger asChild disabled={props.disabled}>
        {props.children}
      </ContextMenuTrigger>
      {/* Focus stays where the item sends it: handed back to the trigger, it
          lands outside the thread as the thread opens, and closes it again. */}
      <EntityMenuContent
        menu="context"
        onCloseAutoFocus={(e) => e.preventDefault()}
        entity={{ type: props.target.type, id: props.target.id, videoId }}
        groups={{
          open: [
            count > 0 && {
              label: `View Comments (${count})`,
              icon: MessageSquare,
              onSelect: props.onComment,
            },
          ],
          create: [
            count === 0 && {
              label: "Add Comment",
              icon: MessageSquarePlus,
              opensDialog: true,
              onSelect: props.onComment,
            },
          ],
        }}
      />
    </ContextMenu>
  );
}

/** Every Animatic surface renders under `/videos/:videoId/animatic`. */
function useVideoIdParam(): string {
  const { videoId } = useParams();
  if (!videoId) {
    throw new Error("Animatic comments render only under /videos/:videoId");
  }
  return videoId;
}

/**
 * The stage's comment thread, opened by its own button or by a right-click on
 * the frame. Both PAUSE the Player first, so the comment lands on the frame
 * that was on screen. With no Clip Mockup on screen the menu is disabled, not
 * removed, so the Player it wraps is never remounted.
 */
export function useStageComments(props: {
  readonly activeMockupId: string | undefined;
  readonly pause: () => void;
}) {
  const [open, setOpen] = useState(false);
  const target: AnimaticCommentTarget = {
    type: "clip-mockup",
    id: props.activeMockupId ?? "",
  };
  return {
    menu: {
      target,
      disabled: !props.activeMockupId,
      onOpenChange: (menuOpen: boolean) => {
        if (menuOpen) props.pause();
      },
      onComment: () => setOpen(true),
    },
    thread: {
      variant: "stage",
      target,
      onOpen: props.pause,
      open,
      onOpenChange: setOpen,
    },
  } as const;
}

/** One place every write of a thread goes through. */
function useCommentWriter() {
  const fetcher = useFetcher<ClipMockupCommentWriteResult>();
  const submit = (event: ClipMockupCommentEvent) =>
    fetcher.submit(event, {
      method: "post",
      action: "/api/clip-mockup-comments",
      encType: "application/json",
    });
  const error =
    fetcher.state === "idle" && fetcher.data && !fetcher.data.ok
      ? fetcher.data.message
      : null;
  return { submit, error, busy: fetcher.state !== "idle" };
}

/**
 * The badge (or the hover-only add icon) and the thread behind it. The caller
 * places it: it is drawn beside the row's own button, never inside it, since a
 * button cannot hold another.
 *
 * The `stage` variant is the same thread as a button on the black stage,
 * beside the CC control, always visible: it comments on whatever Clip Mockup
 * is on screen. THE TARGET IS FROZEN WHILE THE THREAD IS OPEN, so a comment
 * typed as the Animatic plays on still lands on the moment it was opened on.
 *
 * Pass `open` and `onOpenChange` to open it from outside its own button, as
 * `AnimaticCommentContextMenu` does. `onOpen` is for the button alone.
 */
export function AnimaticCommentThread(props: {
  readonly target: AnimaticCommentTarget;
  readonly className?: string;
  readonly variant?: "sidebar" | "stage";
  /** Called as the thread opens — the stage pauses the Player here. */
  readonly onOpen?: () => void;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  // Captured in render, not in `onOpenChange`, so a thread opened from
  // outside freezes its target too.
  const [openTarget, setOpenTarget] = useState<AnimaticCommentTarget | null>(
    null
  );
  if (open && openTarget === null) setOpenTarget(props.target);
  if (!open && openTarget !== null) setOpenTarget(null);
  const target = (open && openTarget) || props.target;
  const comments = useCommentsOn(target);
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const writer = useCommentWriter();
  const stage = props.variant === "stage";

  const onOpenChange = (next: boolean) => {
    if (next) props.onOpen?.();
    setOwnOpen(next);
    props.onOpenChange?.(next);
  };

  const add = () => {
    if (draft.trim() === "") return;
    writer.submit({ type: "create", target, body: draft.trim() });
    setDraft("");
  };

  const label =
    comments.length > 0
      ? `${comments.length} comment${comments.length === 1 ? "" : "s"}`
      : "Add a comment";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {stage ? (
          <button
            type="button"
            aria-label={label}
            title="Comment on this Clip Mockup"
            className={cn(
              "allow-keydown flex items-center gap-1 rounded-md bg-black/70 p-1.5 text-sm tabular-nums hover:bg-black/90",
              comments.length > 0 ? "text-amber-300" : "text-white",
              props.className
            )}
          >
            {comments.length > 0 ? (
              <>
                <MessageSquare className="size-5" />
                {comments.length}
              </>
            ) : (
              <MessageSquarePlus className="size-5" />
            )}
          </button>
        ) : (
          <button
            type="button"
            aria-label={label}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
              comments.length > 0
                ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:hover:bg-amber-400/25"
                : "text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100",
              props.className
            )}
          >
            {comments.length > 0 ? (
              <>
                <MessageSquare className="size-3" />
                {comments.length}
              </>
            ) : (
              <MessageSquarePlus className="size-3.5" />
            )}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={stage ? "bottom" : "right"}
        align={stage ? "end" : "start"}
        className="w-80 p-0"
        // Straight to the new comment, however the thread was opened. Opened
        // from a context menu, `autoFocus` alone loses to the closing menu and
        // focus lands on the first comment's `…` button.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          draftRef.current?.focus();
        }}
      >
        {comments.length > 0 && (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {comments.map((comment) => (
              <CommentItem key={comment.id} comment={comment} />
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 border-t border-border p-3 first:border-t-0">
          <Textarea
            ref={draftRef}
            value={draft}
            placeholder="Add a comment for the filming day…"
            className="min-h-16 text-sm"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                add();
              }
            }}
          />
          {writer.error && (
            <p className="text-xs text-destructive">{writer.error}</p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={draft.trim() === "" || writer.busy}
              onClick={add}
            >
              Comment
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One comment, with the SAME ACTIONS on right-click and behind its `…`
 * button: edit first, delete last and on its own.
 */
function CommentItem(props: { readonly comment: AnimaticComment }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.comment.body);
  const writer = useCommentWriter();
  const videoId = useVideoIdParam();
  const entity = {
    type: "clip-mockup-comment",
    id: props.comment.id,
    videoId,
  } as const;

  const save = () => {
    const body = draft.trim();
    if (body === "") return;
    if (body !== props.comment.body) {
      writer.submit({ type: "update", commentId: props.comment.id, body });
    }
    setEditing(false);
  };

  const groups: ActionMenuGroups = {
    edit: [
      {
        ...STANDARD_ACTIONS.edit,
        // The draft starts from the body as it is NOW, which a poll may have
        // changed since this comment first rendered.
        onSelect: () => {
          setDraft(props.comment.body);
          setEditing(true);
        },
      },
    ],
    danger: [
      {
        ...STANDARD_ACTIONS.delete,
        onSelect: () =>
          writer.submit({ type: "delete", commentId: props.comment.id }),
      },
    ],
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 p-3">
        <Textarea
          autoFocus
          value={draft}
          className="min-h-16 text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft(props.comment.body);
              setEditing(false);
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(props.comment.body);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={draft.trim() === ""} onClick={save}>
            Save
          </Button>
        </div>
      </li>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li className="group/comment flex items-start gap-2 p-3 text-sm">
          <p className="min-w-0 flex-1 whitespace-pre-wrap">
            {props.comment.body}
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Comment actions"
                className="shrink-0 rounded-md p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/comment:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <EntityMenuContent
              menu="dropdown"
              align="end"
              entity={entity}
              groups={groups}
            />
          </DropdownMenu>
          {writer.error && (
            <p className="text-xs text-destructive">{writer.error}</p>
          )}
        </li>
      </ContextMenuTrigger>
      <EntityMenuContent menu="context" entity={entity} groups={groups} />
    </ContextMenu>
  );
}
