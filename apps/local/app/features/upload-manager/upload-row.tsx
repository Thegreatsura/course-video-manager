import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Upload,
  X,
  ExternalLink,
  Cloud,
  Send,
  Film,
  Clock,
} from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
import type { UploadEntry } from "./upload-entry";
import { uploadStageLabel } from "./upload-stage-labels";
import { etaLabel, type UploadEta } from "./upload-eta";
import { Badge } from "@/components/ui/badge";
import type { PostRetry } from "@/features/jobs/jobs-selectors";
import { ENQUEUE_UNCONFIRMED_MESSAGE } from "@/features/jobs/jobs-reducer";

/**
 * What a POST's failed row offers (decision 5): posts never run again on
 * their own, so the author reads what happened and presses Retry.
 */
export interface PostRowControls {
  /** Cut off mid-run: it may or may not have gone out. */
  interrupted: boolean;
  /** What the sidecar found at the service; `null` while it looks. */
  check: {
    verdict: "posted" | "not-posted" | "unknown";
    detail: string;
    url: string | null;
  } | null;
  /** Whether it went out, and whether Retry is offered and asks first. */
  retry: PostRetry;
  onRetry: () => void;
}

export function UploadRow({
  upload,
  onDismiss,
  nested = false,
  eta,
  logHref,
  post = null,
  publishRecoveryHref = null,
  onFollowLink = () => {},
}: {
  upload: UploadEntry;
  onDismiss: (e: React.MouseEvent, uploadId: string) => void;
  /** A failed or interrupted post's check and Retry; `null` otherwise. */
  post?: PostRowControls | null;
  /**
   * A Publish that was cut off, or failed past Submit without Discarding: the
   * publish page, where its Pending Version is Promoted or Discarded by hand.
   * `null` otherwise (`publishRecoveryHrefOf`).
   */
  publishRecoveryHref?: string | null;
  /** Called when a link in the row takes the author to another page. */
  onFollowLink?: () => void;
  /** Where a background Job's log is read, for a failed row; `null` otherwise. */
  logHref: string | null;
  /** A child task, indented under the parent job that spawned it. */
  nested?: boolean;
  /** Its time to finish, from `estimateUploads`. */
  eta?: UploadEta;
}) {
  return (
    <div
      className={`py-2.5 flex items-center gap-3 ${
        nested ? "pl-5 border-l-2 border-muted ml-1.5" : ""
      }`}
    >
      <StatusIcon upload={upload} />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{upload.title}</p>
        <UploadStatusDetail
          upload={upload}
          eta={eta}
          logHref={logHref}
          post={post}
          publishRecoveryHref={publishRecoveryHref}
          onFollowLink={onFollowLink}
        />
      </div>
      {!(upload.uploadType === "export" && upload.isBatchEntry) && (
        <button
          onClick={(e) => onDismiss(e, upload.uploadId)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          type="button"
          aria-label="Dismiss upload"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function StatusIcon({ upload }: { upload: UploadEntry }) {
  switch (upload.status) {
    case "waiting":
      return <Clock className="size-4 text-muted-foreground shrink-0" />;
    case "uploading":
      if (upload.uploadType === "buffer") {
        switch (upload.bufferStage) {
          case "creating-post":
          case "polling":
            return <Send className="size-4 text-blue-500 shrink-0" />;
          case "cleaning-up":
            return <Cloud className="size-4 text-blue-500 shrink-0" />;
          case "uploading-blob":
          case null:
            return <Upload className="size-4 text-blue-500 shrink-0" />;
        }
      }
      if (upload.uploadType === "export") {
        return upload.videoUploadStage ? (
          <Cloud className="size-4 text-blue-500 shrink-0" />
        ) : (
          <Film className="size-4 text-blue-500 shrink-0" />
        );
      }
      if (upload.uploadType === "publish") {
        return <Send className="size-4 text-blue-500 shrink-0" />;
      }
      return <Upload className="size-4 text-blue-500 shrink-0" />;
    case "retrying":
      return (
        <RefreshCw className="size-4 text-yellow-500 shrink-0 animate-spin" />
      );
    case "success":
      return <CheckCircle2 className="size-4 text-green-500 shrink-0" />;
    case "error":
      return <AlertCircle className="size-4 text-destructive shrink-0" />;
  }
}

/**
 * The inline per-job progress bar. Every unfinished job gets one, so the modal
 * reads as one column of bars rather than a mix of bars and prose: `label`
 * names the stage (when the job type has stages) and `percent` fills the bar.
 * `remaining` is the ETA's text, shown after the percent.
 */
function InlineProgress({
  label,
  percent,
  tone,
  remaining = null,
}: {
  label: string | null;
  percent: number;
  tone: "active" | "retrying";
  remaining?: string | null;
}) {
  return (
    <div className="flex items-center gap-2 mt-0.5">
      {label && (
        <p
          className={`text-xs shrink-0 ${
            tone === "retrying" ? "text-yellow-500" : "text-muted-foreground"
          }`}
        >
          {label}
        </p>
      )}
      <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label ? `${label}: ${percent}%` : `${percent}%`}
          className={`h-full rounded-full transition-all duration-300 ${
            tone === "retrying" ? "bg-yellow-500" : "bg-blue-500"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground min-w-8 text-right whitespace-nowrap shrink-0">
        {percent}%{remaining && ` · ${remaining}`}
      </span>
    </div>
  );
}

function UploadStatusDetail({
  upload,
  eta,
  logHref,
  post,
  publishRecoveryHref,
  onFollowLink,
}: {
  upload: UploadEntry;
  eta?: UploadEta;
  logHref: string | null;
  post: PostRowControls | null;
  publishRecoveryHref: string | null;
  onFollowLink: () => void;
}) {
  switch (upload.status) {
    case "waiting":
      return (
        <InlineProgress label="Waiting for export" percent={0} tone="active" />
      );
    case "uploading":
      return (
        <InlineProgress
          label={uploadStageLabel(upload)}
          percent={upload.progress}
          tone="active"
          remaining={eta ? etaLabel(eta) : null}
        />
      );
    case "retrying":
      return (
        <InlineProgress
          label={
            // An enqueue gone unanswered is being asked again, not retried.
            upload.errorMessage === ENQUEUE_UNCONFIRMED_MESSAGE
              ? ENQUEUE_UNCONFIRMED_MESSAGE
              : `Retrying (attempt ${upload.retryCount + 1})`
          }
          percent={upload.progress}
          tone="retrying"
        />
      );
    case "success":
      return <SuccessDetail upload={upload} onFollowLink={onFollowLink} />;
    case "error":
      if (publishRecoveryHref) {
        return (
          <PublishRecoveryDetail
            message={upload.errorMessage}
            logHref={logHref}
            recoveryHref={publishRecoveryHref}
            onFollowLink={onFollowLink}
          />
        );
      }
      if (post) {
        return (
          <PostFailedDetail upload={upload} logHref={logHref} post={post} />
        );
      }
      return (
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className="text-xs text-destructive truncate"
            title={upload.errorMessage ?? undefined}
          >
            {upload.errorMessage}
          </span>
          {logHref && (
            <a
              href={logHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              View log
            </a>
          )}
          {/* A child task's Video belongs to the job above it, not to a
              social post — the same reason a Publish or an Autofill (a
              Course, not a Video) offers no link here. */}
          {upload.uploadType !== "publish" &&
            upload.uploadType !== "autofill" &&
            upload.uploadType !== "duplicate-course" &&
            !upload.parentUploadId && (
              <Link
                to={`/videos/${upload.videoId}/post`}
                className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
                onClick={(e) => e.stopPropagation()}
              >
                Go to Post
              </Link>
            )}
        </div>
      );
  }
}

/**
 * A Publish that was cut off, or failed past Submit (plan §7.2): it never runs
 * again on its own, and a Pending Version it may have left is reconciled on
 * the publish page.
 */
function PublishRecoveryDetail({
  message,
  logHref,
  recoveryHref,
  onFollowLink,
}: {
  message: string | null;
  logHref: string | null;
  recoveryHref: string;
  onFollowLink: () => void;
}) {
  return (
    <div className="mt-0.5 space-y-1">
      <p className="text-xs text-yellow-600 dark:text-yellow-500">{message}</p>
      <div className="flex items-center gap-3">
        <Link
          to={recoveryHref}
          className="text-xs font-medium text-foreground underline underline-offset-2 whitespace-nowrap"
          onClick={(e) => {
            e.stopPropagation();
            onFollowLink();
          }}
        >
          Promote or Discard on the publish page
        </Link>
        {logHref && (
          <a
            href={logHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            View log
          </a>
        )}
      </div>
    </div>
  );
}

const CHECK_TONE = {
  posted: "text-yellow-600 dark:text-yellow-500",
  "not-posted": "text-muted-foreground",
  unknown: "text-yellow-600 dark:text-yellow-500",
} as const;

/**
 * A post that failed, or was cut off: why, what the check found at the
 * service, its log, and the author's Retry (`postRetryOf`): none once it
 * went out, and "Post again?" first whenever it may have.
 */
function PostFailedDetail({
  upload,
  logHref,
  post,
}: {
  upload: UploadEntry;
  logHref: string | null;
  post: PostRowControls;
}) {
  const [confirming, setConfirming] = useState(false);
  const retry = post.retry.type === "retry" ? post.retry : null;
  return (
    <div className="mt-0.5 space-y-0.5">
      <p
        className={`text-xs ${post.interrupted ? "text-yellow-600 dark:text-yellow-500" : "text-destructive"}`}
        title={upload.errorMessage ?? undefined}
      >
        {post.interrupted
          ? "Interrupted — check before retrying"
          : upload.errorMessage}
      </p>
      {post.interrupted && (
        <p
          className={`text-xs ${post.check ? CHECK_TONE[post.check.verdict] : "text-muted-foreground"}`}
          role="status"
        >
          {post.check ? post.check.detail : "Checking whether it went out…"}
          {post.check?.url && (
            <>
              {" "}
              <SuccessLink href={post.check.url}>Open</SuccessLink>
            </>
          )}
        </p>
      )}
      {!post.interrupted && post.retry.type === "went-out" && (
        <p
          className="text-xs text-yellow-600 dark:text-yellow-500"
          role="status"
        >
          It went out before this failed, so it is not offered again.
          {post.retry.url && (
            <>
              {" "}
              <SuccessLink href={post.retry.url}>Open</SuccessLink>
            </>
          )}
        </p>
      )}
      <div className="flex items-center gap-2">
        {retry &&
          (confirming ? (
            <button
              type="button"
              className="text-xs text-destructive hover:underline whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
                post.onRetry();
              }}
            >
              Post again?
            </button>
          ) : (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap inline-flex items-center gap-1"
              onClick={(e) => {
                e.stopPropagation();
                if (retry.confirm) setConfirming(true);
                else post.onRetry();
              }}
            >
              <RefreshCw className="size-3" />
              Retry
            </button>
          ))}
        {logHref && (
          <a
            href={logHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            View log
          </a>
        )}
        <Link
          to={`/videos/${upload.videoId}/post`}
          className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
          onClick={(e) => e.stopPropagation()}
        >
          Go to Post
        </Link>
      </div>
    </div>
  );
}

/** Where a finished job landed, plus a link to it when there is one to give. */
function SuccessDetail({
  upload,
  onFollowLink,
}: {
  upload: UploadEntry;
  onFollowLink: () => void;
}) {
  switch (upload.uploadType) {
    case "buffer":
      return <SuccessBadge label="Sent to Buffer" />;
    case "export":
      // A per-Video task under a Publish did not stop at the export: it also
      // shipped the file to Dropbox.
      return (
        <SuccessBadge label={upload.parentUploadId ? "Uploaded" : "Exported"} />
      );
    case "publish":
      return <SuccessBadge label="Published" />;
    case "ai-hero":
      return (
        <SuccessBadge label="Posted to AI Hero">
          {upload.aiHeroSlug && (
            <SuccessLink href={`https://aihero.dev/${upload.aiHeroSlug}`}>
              View Post
            </SuccessLink>
          )}
        </SuccessBadge>
      );
    case "youtube":
      return (
        <SuccessBadge label="Complete">
          {upload.youtubeVideoId && (
            <SuccessLink
              href={`https://studio.youtube.com/video/${upload.youtubeVideoId}/edit`}
            >
              YouTube Studio
            </SuccessLink>
          )}
        </SuccessBadge>
      );
    case "youtube-shorts":
    case "skills-changelog":
    case "render-vertical":
      return <SuccessBadge label="Complete" />;
    case "duplicate-course":
      return (
        <SuccessBadge label="Duplicated">
          <Link
            to={`/courses/${upload.courseId}`}
            className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
            onClick={(e) => {
              e.stopPropagation();
              onFollowLink();
            }}
          >
            Open Course
          </Link>
        </SuccessBadge>
      );
    case "autofill":
      // An autofill run's result lands in the Video itself; there is no
      // destination to name — except a field the author changed while it
      // ran, which kept their text, so the Autofill's is offered here.
      return upload.kept.length > 0 ? (
        <div className="mt-0.5 space-y-0.5">
          {upload.kept.map((kept) => (
            <p
              key={kept.field}
              className="text-xs text-muted-foreground select-text"
            >
              Kept your {kept.field}. Autofill offered: {kept.proposal}
            </p>
          ))}
        </div>
      ) : null;
  }
}

function SuccessBadge({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mt-0.5">
      <Badge
        variant="secondary"
        className="text-green-500 text-[10px] px-1.5 py-0"
      >
        {label}
      </Badge>
      {children}
    </div>
  );
}

function SuccessLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}
