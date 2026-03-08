import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Code, MessageCircle, Play } from "lucide-react";
import type {
  LessonPriority,
  LessonIcon,
} from "@/features/course-planner/types";
import type { planStateReducer } from "@/features/course-planner/plan-state-reducer";

interface IconStats {
  code: { total: number; done: number };
  discussion: { total: number; done: number };
  watch: { total: number; done: number };
}

export interface PlanStatsBarProps {
  iconStats: IconStats;
  totalLessons: number;
  estimatedVideos: number;
  priorityFilter: LessonPriority[];
  iconFilter: LessonIcon[];
  dispatch: (action: planStateReducer.Action) => void;
}

export function PlanStatsBar({
  iconStats,
  totalLessons,
  estimatedVideos,
  priorityFilter,
  iconFilter,
  dispatch,
}: PlanStatsBarProps) {
  const getPercentage = (stats: { total: number; done: number }) =>
    stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div className="sticky top-0 z-10 bg-background py-3 -mx-6 px-6 border-b">
      {/* Stats */}
      <div className="flex items-center gap-2">
        {iconStats.code.total > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-yellow-500/20 text-yellow-600 px-2 py-1 text-xs font-medium">
            <Code className="w-3 h-3" />
            {getPercentage(iconStats.code)}%
          </span>
        )}
        {iconStats.discussion.total > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-green-500/20 text-green-600 px-2 py-1 text-xs font-medium">
            <MessageCircle className="w-3 h-3" />
            {getPercentage(iconStats.discussion)}%
          </span>
        )}
        {iconStats.watch.total > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-500/20 text-purple-600 px-2 py-1 text-xs font-medium">
            <Play className="w-3 h-3" />
            {getPercentage(iconStats.watch)}%
          </span>
        )}
        <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
          {totalLessons} lessons
        </span>
        <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
          ~{estimatedVideos} videos
        </span>
      </div>

      {/* Priority Filter */}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-muted-foreground">Filter:</span>
        {([1, 2, 3] as const).map((priority) => {
          const isSelected = priorityFilter.includes(priority);
          const showAsActive = priorityFilter.length === 0 || isSelected;
          return (
            <button
              key={priority}
              className={`text-xs px-2 py-0.5 rounded-sm font-medium transition-colors ${
                showAsActive
                  ? priority === 1
                    ? "bg-red-500/20 text-red-600"
                    : priority === 2
                      ? "bg-yellow-500/20 text-yellow-600"
                      : "bg-sky-500/20 text-sky-500"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              } ${isSelected ? "ring-1 ring-current" : ""}`}
              onClick={() =>
                dispatch({
                  type: "priority-filter-toggled",
                  priority,
                })
              }
            >
              P{priority}
            </button>
          );
        })}

        {/* Icon Filter */}
        <span className="text-muted-foreground mx-1">|</span>
        {(["code", "discussion", "watch"] as const).map((icon) => {
          const isSelected = iconFilter.includes(icon);
          const showAsActive = iconFilter.length === 0 || isSelected;
          return (
            <button
              key={icon}
              className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
                icon === "code"
                  ? showAsActive
                    ? "bg-yellow-500/20 text-yellow-600"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                  : icon === "discussion"
                    ? showAsActive
                      ? "bg-green-500/20 text-green-600"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                    : showAsActive
                      ? "bg-purple-500/20 text-purple-600"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
              } ${isSelected ? "ring-1 ring-current" : ""}`}
              onClick={() =>
                dispatch({
                  type: "icon-filter-toggled",
                  icon,
                })
              }
              title={
                icon === "code"
                  ? "Interactive"
                  : icon === "discussion"
                    ? "Discussion"
                    : "Watch"
              }
            >
              {icon === "code" ? (
                <Code className="w-3 h-3" />
              ) : icon === "discussion" ? (
                <MessageCircle className="w-3 h-3" />
              ) : (
                <Play className="w-3 h-3" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface PlanDeleteDialogsProps {
  deletingSection: planStateReducer.State["deletingSection"];
  deletingLesson: planStateReducer.State["deletingLesson"];
  dispatch: (action: planStateReducer.Action) => void;
}

export function PlanDeleteDialogs({
  deletingSection,
  deletingLesson,
  dispatch,
}: PlanDeleteDialogsProps) {
  return (
    <>
      {/* Delete Section Confirmation Dialog */}
      <Dialog
        open={deletingSection !== null}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "section-delete-cancelled" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Section?</DialogTitle>
            <DialogDescription>
              This section contains{" "}
              {deletingSection?.lessonCount === 1
                ? "1 lesson"
                : `${deletingSection?.lessonCount} lessons`}
              . Deleting this section will also delete all its lessons. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "section-delete-cancelled" })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => dispatch({ type: "section-delete-confirmed" })}
            >
              Delete Section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Lesson Confirmation Dialog */}
      <Dialog
        open={deletingLesson !== null}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "lesson-delete-cancelled" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Lesson?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "lesson-delete-cancelled" })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => dispatch({ type: "lesson-delete-confirmed" })}
            >
              Delete Lesson
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
