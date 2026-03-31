import { AddCourseModal } from "@/components/add-course-modal";
import { AddStandaloneVideoModal } from "@/components/add-standalone-video-modal";
import { CreatePlanModal } from "@/components/create-plan-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Plan } from "@/features/course-planner/types";
import { cn } from "@/lib/utils";
import {
  Archive,
  ClipboardList,
  Eye,
  FolderGit2,
  FolderOpen,
  Menu,
  PencilIcon,
  Plus,
  Trash2,
  VideoIcon,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link, useFetcher, useLocation } from "react-router";

export interface AppSidebarProps {
  courses: Array<{
    id: string;
    name: string;
  }>;
  standaloneVideos: Array<{
    id: string;
    path: string;
  }>;
  plans: Plan[];
  showPlansSection?: boolean;
  selectedCourseId?: string | null;
  isAddCourseModalOpen?: boolean;
  setIsAddCourseModalOpen?: (open: boolean) => void;
  isAddStandaloneVideoModalOpen?: boolean;
  setIsAddStandaloneVideoModalOpen?: (open: boolean) => void;
}

export function AppSidebar({
  courses,
  standaloneVideos,
  plans,
  showPlansSection = false,
  selectedCourseId = null,
  isAddCourseModalOpen = false,
  setIsAddCourseModalOpen,
  isAddStandaloneVideoModalOpen = false,
  setIsAddStandaloneVideoModalOpen,
}: AppSidebarProps) {
  const location = useLocation();
  const archiveCourseFetcher = useFetcher();
  const archiveVideoFetcher = useFetcher();
  const revealVideoFetcher = useFetcher();
  const deletePlanFetcher = useFetcher();
  const renamePlanFetcher = useFetcher();
  const archivePlanFetcher = useFetcher();

  const [isCreatePlanModalOpen, setIsCreatePlanModalOpen] = useState(false);
  const [isInternalAddVideoModalOpen, setIsInternalAddVideoModalOpen] =
    useState(false);
  const [videoToRename, setVideoToRename] = useState<{
    id: string;
    path: string;
  } | null>(null);
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [renamingPlanTitle, setRenamingPlanTitle] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingPlanId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingPlanId]);

  // Close mobile sheet on navigation
  useEffect(() => {
    setSheetOpen(false);
  }, [location.pathname, location.search]);

  const handleSavePlanRename = () => {
    if (renamingPlanId && renamingPlanTitle.trim()) {
      renamePlanFetcher.submit(
        { title: renamingPlanTitle.trim() },
        { method: "post", action: `/api/plans/${renamingPlanId}/rename` }
      );
    }
    setRenamingPlanId(null);
    setRenamingPlanTitle("");
  };

  const handleCancelPlanRename = () => {
    setRenamingPlanId(null);
    setRenamingPlanTitle("");
  };

  const sidebarContent = (
    <>
      {/* Courses Card */}
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Courses</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsAddCourseModalOpen?.(true)}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="space-y-0.5">
          {courses.map((course) => (
            <ContextMenu key={course.id}>
              <ContextMenuTrigger asChild>
                <Link
                  to={`/?courseId=${course.id}`}
                  preventScrollReset
                  className={cn(
                    "block w-full text-left text-sm px-2 py-1.5 rounded-md hover:bg-accent transition-colors",
                    selectedCourseId === course.id &&
                      "bg-muted text-foreground/90"
                  )}
                >
                  {course.name}
                </Link>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => {
                    archiveCourseFetcher.submit(
                      { archived: "true" },
                      {
                        method: "post",
                        action: `/api/courses/${course.id}/archive`,
                      }
                    );
                  }}
                >
                  <Archive className="w-4 h-4" />
                  Archive
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
        <Link
          to="/archived-courses"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-2 px-2 transition-colors"
        >
          <Archive className="w-3 h-3" />
          Archived Courses
        </Link>
      </div>

      {/* Videos Card */}
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <VideoIcon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Videos</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              if (setIsAddStandaloneVideoModalOpen) {
                setIsAddStandaloneVideoModalOpen(true);
              } else {
                setIsInternalAddVideoModalOpen(true);
              }
            }}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="space-y-0.5">
          {standaloneVideos.map((video) => (
            <ContextMenu key={video.id}>
              <ContextMenuTrigger asChild>
                <Link
                  to={`/videos/${video.id}/edit`}
                  preventScrollReset
                  className="block w-full text-left text-sm px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
                >
                  {video.path}
                </Link>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => {
                    setVideoToRename({ id: video.id, path: video.path });
                  }}
                >
                  <PencilIcon className="w-4 h-4" />
                  Rename
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    revealVideoFetcher.submit(
                      {},
                      {
                        method: "post",
                        action: `/api/videos/${video.id}/reveal`,
                      }
                    );
                  }}
                >
                  <FolderOpen className="w-4 h-4" />
                  Reveal in File System
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    archiveVideoFetcher.submit(
                      { archived: "true" },
                      {
                        method: "post",
                        action: `/api/videos/${video.id}/archive`,
                      }
                    );
                  }}
                >
                  <Archive className="w-4 h-4" />
                  Archive
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
        <Link
          to="/videos"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-2 px-2 transition-colors"
        >
          <Eye className="w-3 h-3" />
          View All Videos
        </Link>
      </div>

      {/* Plans Card */}
      {showPlansSection && (
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Plans</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsCreatePlanModalOpen(true)}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="space-y-0.5">
            {plans.map((plan) =>
              renamingPlanId === plan.id ? (
                <Input
                  key={plan.id}
                  ref={renameInputRef}
                  value={renamingPlanTitle}
                  onChange={(e) => setRenamingPlanTitle(e.target.value)}
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSavePlanRename();
                    if (e.key === "Escape") handleCancelPlanRename();
                  }}
                  onBlur={handleSavePlanRename}
                />
              ) : (
                <ContextMenu key={plan.id}>
                  <ContextMenuTrigger asChild>
                    <Link
                      to={`/plans/${plan.id}`}
                      preventScrollReset
                      className="block w-full text-left text-sm px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
                    >
                      {plan.title}
                    </Link>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => {
                        setRenamingPlanId(plan.id);
                        setRenamingPlanTitle(plan.title);
                      }}
                    >
                      <PencilIcon className="w-4 h-4" />
                      Rename
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => {
                        archivePlanFetcher.submit(
                          { archived: "true" },
                          {
                            method: "post",
                            action: `/api/plans/${plan.id}/archive`,
                          }
                        );
                      }}
                    >
                      <Archive className="w-4 h-4" />
                      Archive
                    </ContextMenuItem>
                    <ContextMenuItem
                      variant="destructive"
                      onSelect={() => {
                        deletePlanFetcher.submit(
                          {},
                          {
                            method: "post",
                            action: `/api/plans/${plan.id}/delete`,
                          }
                        );
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            )}
            {plans.length === 0 && (
              <p className="text-sm text-muted-foreground px-2">No plans yet</p>
            )}
          </div>
          <Link
            to="/archived-plans"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-2 px-2 transition-colors"
          >
            <Archive className="w-3 h-3" />
            Archived Plans
          </Link>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Static sidebar for large screens */}
      <div className="w-80 border-r bg-muted/30 hidden lg:flex flex-col">
        <div className="p-4 flex-1 flex flex-col min-h-0">
          <div className="space-y-3 flex-1 overflow-y-auto">
            {sidebarContent}
          </div>
        </div>
      </div>

      {/* Floating menu button for smaller screens */}
      <Button
        className="lg:hidden fixed bottom-4 left-4 z-40 rounded-full shadow-lg size-12"
        size="icon"
        onClick={() => setSheetOpen(true)}
      >
        <Menu className="size-5" />
      </Button>

      {/* Mobile sidebar sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="p-0 flex flex-col">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="p-4 flex-1 flex flex-col min-h-0">
            <div className="space-y-3 flex-1 overflow-y-auto">
              {sidebarContent}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Modals */}
      {setIsAddCourseModalOpen && (
        <AddCourseModal
          isOpen={isAddCourseModalOpen}
          onOpenChange={setIsAddCourseModalOpen}
        />
      )}
      {setIsAddStandaloneVideoModalOpen ? (
        <AddStandaloneVideoModal
          open={isAddStandaloneVideoModalOpen}
          onOpenChange={setIsAddStandaloneVideoModalOpen}
        />
      ) : (
        <AddStandaloneVideoModal
          open={isInternalAddVideoModalOpen}
          onOpenChange={setIsInternalAddVideoModalOpen}
        />
      )}
      <CreatePlanModal
        isOpen={isCreatePlanModalOpen}
        onOpenChange={setIsCreatePlanModalOpen}
      />
      {videoToRename && (
        <RenameVideoModal
          videoId={videoToRename.id}
          currentName={videoToRename.path}
          open={true}
          onOpenChange={(open) => {
            if (!open) setVideoToRename(null);
          }}
        />
      )}
    </>
  );
}
