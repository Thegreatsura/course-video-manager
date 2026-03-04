import { AddRepoModal } from "@/components/add-repo-modal";
import { AddStandaloneVideoModal } from "@/components/add-standalone-video-modal";
import { CreatePlanModal } from "@/components/create-plan-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  ChevronRight,
  ClipboardList,
  FolderGit2,
  FolderOpen,
  Menu,
  PencilIcon,
  Plus,
  Trash2,
  VideoIcon,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link, useFetcher, useLocation, useNavigate } from "react-router";

export interface AppSidebarProps {
  repos: Array<{
    id: string;
    name: string;
  }>;
  standaloneVideos: Array<{
    id: string;
    path: string;
  }>;
  plans: Plan[];
  selectedRepoId?: string | null;
  isAddRepoModalOpen?: boolean;
  setIsAddRepoModalOpen?: (open: boolean) => void;
  isAddStandaloneVideoModalOpen?: boolean;
  setIsAddStandaloneVideoModalOpen?: (open: boolean) => void;
}

export function AppSidebar({
  repos,
  standaloneVideos,
  plans,
  selectedRepoId = null,
  isAddRepoModalOpen = false,
  setIsAddRepoModalOpen,
  isAddStandaloneVideoModalOpen = false,
  setIsAddStandaloneVideoModalOpen,
}: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const archiveRepoFetcher = useFetcher();
  const archiveVideoFetcher = useFetcher();
  const revealVideoFetcher = useFetcher();
  const deletePlanFetcher = useFetcher();
  const renamePlanFetcher = useFetcher();

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
      {/* Courses */}
      <Collapsible defaultOpen>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger className="flex items-center gap-2 text-lg font-semibold hover:text-foreground/80 transition-colors group">
            <ChevronRight className="w-4 h-4 transition-transform group-data-[state=open]:rotate-90" />
            <FolderGit2 className="w-5 h-5" />
            Courses
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsAddRepoModalOpen?.(true)}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <CollapsibleContent>
          <div className="ml-6 mt-2 space-y-1">
            {repos.map((repo) => (
              <ContextMenu key={repo.id}>
                <ContextMenuTrigger asChild>
                  <Button
                    variant={selectedRepoId === repo.id ? "default" : "ghost"}
                    size="sm"
                    className={cn(
                      "w-full justify-start whitespace-normal text-left h-auto py-1.5",
                      selectedRepoId === repo.id &&
                        "bg-muted text-foreground/90 hover:bg-muted/90"
                    )}
                    onClick={() => {
                      navigate(`/?repoId=${repo.id}`, {
                        preventScrollReset: true,
                      });
                    }}
                  >
                    {repo.name}
                  </Button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      archiveRepoFetcher.submit(
                        { archived: "true" },
                        {
                          method: "post",
                          action: `/api/repos/${repo.id}/archive`,
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

            {/* Archived Courses */}
            <Link to="/archived-repos">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground"
              >
                Archived Courses
              </Button>
            </Link>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Videos */}
      <Collapsible defaultOpen>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger className="flex items-center gap-2 text-lg font-semibold hover:text-foreground/80 transition-colors group">
            <ChevronRight className="w-4 h-4 transition-transform group-data-[state=open]:rotate-90" />
            <VideoIcon className="w-5 h-5" />
            Videos
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              if (setIsAddStandaloneVideoModalOpen) {
                setIsAddStandaloneVideoModalOpen(true);
              } else {
                setIsInternalAddVideoModalOpen(true);
              }
            }}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <CollapsibleContent>
          <div className="ml-6 mt-2 space-y-1">
            {standaloneVideos.map((video) => (
              <ContextMenu key={video.id}>
                <ContextMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start whitespace-normal text-left h-auto py-1.5"
                    asChild
                  >
                    <Link to={`/videos/${video.id}/edit`}>{video.path}</Link>
                  </Button>
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
            <Link to="/videos">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground"
              >
                View All Videos
              </Button>
            </Link>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Plans */}
      <Collapsible defaultOpen>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger className="flex items-center gap-2 text-lg font-semibold hover:text-foreground/80 transition-colors group">
            <ChevronRight className="w-4 h-4 transition-transform group-data-[state=open]:rotate-90" />
            <ClipboardList className="w-5 h-5" />
            Plans
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsCreatePlanModalOpen(true)}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <CollapsibleContent>
          <div className="ml-6 mt-2 space-y-1">
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start whitespace-normal text-left h-auto py-1.5"
                      asChild
                    >
                      <Link to={`/plans/${plan.id}`}>{plan.title}</Link>
                    </Button>
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
        </CollapsibleContent>
      </Collapsible>
    </>
  );

  return (
    <>
      {/* Static sidebar for large screens */}
      <div className="w-80 border-r bg-muted/30 hidden lg:flex flex-col">
        <div className="p-4 flex-1 flex flex-col min-h-0">
          <div className="space-y-2 flex-1 overflow-y-auto">
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
            <div className="space-y-2 flex-1 overflow-y-auto">
              {sidebarContent}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Modals */}
      {setIsAddRepoModalOpen && (
        <AddRepoModal
          isOpen={isAddRepoModalOpen}
          onOpenChange={setIsAddRepoModalOpen}
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
