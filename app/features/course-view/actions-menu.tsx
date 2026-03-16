import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { LoaderData } from "./course-view-types";
import {
  Archive,
  ChevronDown,
  Download,
  Film,
  FileText,
  FileX,
  GitBranch,
  PencilIcon,
  FolderPen,
  ClipboardCopy,
  Upload,
} from "lucide-react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";

export function ActionsDropdown({
  currentCourse,
  data,
  dispatch,
  archiveCourseFetcher,
  gitPushFetcher,
  handleBatchExport,
}: {
  currentCourse: NonNullable<LoaderData["selectedCourse"]>;
  data: LoaderData;
  dispatch: (action: courseViewReducer.Action) => void;
  archiveCourseFetcher: ReturnType<typeof useFetcher>;
  gitPushFetcher: ReturnType<typeof useFetcher>;
  handleBatchExport: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          Actions
          <ChevronDown className="w-4 h-4 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {data.isLatestVersion && (
          <>
            <DropdownMenuItem
              disabled={!data.selectedVersion}
              onSelect={() => {
                handleBatchExport();
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              <div className="flex flex-col">
                <span className="font-medium">Export</span>
                <span className="text-xs text-muted-foreground">
                  Export videos not yet exported
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to={`/courses/${currentCourse.id}/publish`}>
                <Upload className="w-4 h-4 mr-2" />
                <div className="flex flex-col">
                  <span className="font-medium">Publish</span>
                  <span className="text-xs text-muted-foreground">
                    Review changes and publish to Dropbox
                  </span>
                </div>
              </Link>
            </DropdownMenuItem>
          </>
        )}

        {data.gitStatus && data.gitStatus.total > 0 && (
          <DropdownMenuItem
            disabled={gitPushFetcher.state === "submitting"}
            onSelect={() => {
              gitPushFetcher
                .submit(
                  {},
                  {
                    method: "post",
                    action: `/api/courses/${currentCourse.id}/git-push`,
                  }
                )
                .then(() => {
                  toast.success("Changes pushed to git");
                })
                .catch((e) => {
                  console.error("Git push failed", e);
                  toast.error("Git push failed");
                });
            }}
          >
            <GitBranch className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span className="font-medium">Push</span>
              <span className="text-xs text-muted-foreground">
                Add, commit & push {data.gitStatus.total} change
                {data.gitStatus.total !== 1 ? "s" : ""}
              </span>
            </div>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Course</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() =>
              dispatch({
                type: "set-rename-course-modal-open",
                open: true,
              })
            }
          >
            <PencilIcon className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span className="font-medium">Rename Course</span>
              <span className="text-xs text-muted-foreground">
                Change course name
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              dispatch({
                type: "set-rewrite-course-path-modal-open",
                open: true,
              })
            }
          >
            <FolderPen className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span className="font-medium">Rewrite Course Repo Path</span>
              <span className="text-xs text-muted-foreground">
                Change course repo file path
              </span>
            </div>
          </DropdownMenuItem>
          {currentCourse.sections.some((s) =>
            s.lessons.some((l) => l.fsStatus !== "ghost" && l.videos.length > 0)
          ) && (
            <DropdownMenuItem
              onSelect={() =>
                dispatch({
                  type: "set-copy-transcript-modal-open",
                  open: true,
                })
              }
            >
              <ClipboardCopy className="w-4 h-4 mr-2" />
              <div className="flex flex-col">
                <span className="font-medium">Copy Course Transcript</span>
                <span className="text-xs text-muted-foreground">
                  Copy all transcripts to clipboard
                </span>
              </div>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              archiveCourseFetcher.submit(
                {
                  archived: currentCourse.archived ? "false" : "true",
                },
                {
                  method: "post",
                  action: `/api/courses/${currentCourse.id}/archive`,
                }
              );
            }}
          >
            <Archive className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span className="font-medium">
                {currentCourse.archived ? "Unarchive" : "Archive"} Course
              </span>
              <span className="text-xs text-muted-foreground">
                {currentCourse.archived
                  ? "Restore course to active list"
                  : "Hide course from main view"}
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        {data.selectedVersion && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Version</DropdownMenuLabel>
            <DropdownMenuGroup>
              {data.showMediaFilesList && (
                <DropdownMenuItem asChild>
                  <Link
                    to={`/courses/${currentCourse.id}/versions/${data.selectedVersion.id}/media-files`}
                  >
                    <Film className="w-4 h-4 mr-2" />
                    <div className="flex flex-col">
                      <span className="font-medium">View Media Files</span>
                      <span className="text-xs text-muted-foreground">
                        List source footage for clips
                      </span>
                    </div>
                  </Link>
                </DropdownMenuItem>
              )}
              {data.versions.length > 1 && (
                <DropdownMenuItem asChild>
                  <Link to={`/courses/${currentCourse.id}/changelog`}>
                    <FileText className="w-4 h-4 mr-2" />
                    <div className="flex flex-col">
                      <span className="font-medium">Preview Changelog</span>
                      <span className="text-xs text-muted-foreground">
                        View changes between versions
                      </span>
                    </div>
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Storage</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() =>
                  dispatch({
                    type: "set-clear-video-files-modal-open",
                    open: true,
                  })
                }
                className="text-destructive focus:text-destructive"
              >
                <FileX className="w-4 h-4 mr-2" />
                <div className="flex flex-col">
                  <span className="font-medium">Clear Video Files</span>
                  <span className="text-xs text-muted-foreground">
                    Delete exported videos from file system
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
