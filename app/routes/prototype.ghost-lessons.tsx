import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BookOpen,
  Code,
  FileVideo,
  Ghost,
  GripVertical,
  Link2,
  MessageCircle,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useState, useCallback, useReducer } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type FsStatus = "ghost" | "real";
type LessonIcon = "watch" | "code" | "discussion";
type LessonPriority = 1 | 2 | 3;

interface Lesson {
  id: string;
  title: string;
  order: number;
  fsStatus: FsStatus;
  description: string;
  icon: LessonIcon;
  priority: LessonPriority;
  dependencies: string[];
  // Only present for real lessons
  videos?: { id: string; path: string; durationSeconds: number }[];
}

interface Section {
  id: string;
  title: string;
  order: number;
  lessons: Lesson[];
}

// ─── Mock Data ──────────────────────────────────────────────────────────────

const INITIAL_SECTIONS: Section[] = [
  {
    id: "s1",
    title: "01-fundamentals",
    order: 1,
    lessons: [
      {
        id: "l1",
        title: "What is TypeScript?",
        order: 1,
        fsStatus: "real",
        description: "An introduction to TypeScript and why it exists.",
        icon: "watch",
        priority: 1,
        dependencies: [],
        videos: [
          { id: "v1", path: "problem", durationSeconds: 142 },
          { id: "v2", path: "solution", durationSeconds: 318 },
        ],
      },
      {
        id: "l2",
        title: "Setting Up Your Environment",
        order: 2,
        fsStatus: "real",
        description: "",
        icon: "code",
        priority: 1,
        dependencies: ["l1"],
        videos: [
          { id: "v3", path: "problem", durationSeconds: 95 },
          { id: "v4", path: "solution", durationSeconds: 247 },
          { id: "v5", path: "explainer", durationSeconds: 186 },
        ],
      },
      {
        id: "l3",
        title: "Type Annotations Basics",
        order: 3,
        fsStatus: "ghost",
        description:
          "Cover the basic type annotations: string, number, boolean, arrays, and objects.",
        icon: "code",
        priority: 1,
        dependencies: ["l2"],
      },
      {
        id: "l4",
        title: "Your First Type Error",
        order: 4,
        fsStatus: "ghost",
        description: "",
        icon: "watch",
        priority: 2,
        dependencies: ["l3"],
      },
    ],
  },
  {
    id: "s2",
    title: "02-intermediate",
    order: 2,
    lessons: [
      {
        id: "l5",
        title: "Union Types",
        order: 1,
        fsStatus: "real",
        description: "",
        icon: "code",
        priority: 1,
        dependencies: ["l3"],
        videos: [
          { id: "v6", path: "problem", durationSeconds: 78 },
          { id: "v7", path: "solution", durationSeconds: 203 },
        ],
      },
      {
        id: "l6",
        title: "Intersection Types",
        order: 2,
        fsStatus: "ghost",
        description: "How to combine types with the & operator.",
        icon: "code",
        priority: 2,
        dependencies: ["l5"],
      },
      {
        id: "l7",
        title: "Discriminated Unions",
        order: 3,
        fsStatus: "ghost",
        description: "",
        icon: "watch",
        priority: 2,
        dependencies: ["l5"],
      },
      {
        id: "l8",
        title: "Type Narrowing Deep Dive",
        order: 4,
        fsStatus: "ghost",
        description:
          "typeof, instanceof, in operator, discriminated unions, and custom type guards.",
        icon: "discussion",
        priority: 3,
        dependencies: ["l6", "l7"],
      },
    ],
  },
  {
    id: "s3",
    title: "03-advanced-patterns",
    order: 3,
    lessons: [
      {
        id: "l9",
        title: "Generic Functions",
        order: 1,
        fsStatus: "ghost",
        description: "",
        icon: "code",
        priority: 2,
        dependencies: ["l5"],
      },
      {
        id: "l10",
        title: "Conditional Types",
        order: 2,
        fsStatus: "ghost",
        description: "",
        icon: "watch",
        priority: 3,
        dependencies: ["l9"],
      },
    ],
  },
];

// ─── Reducer ────────────────────────────────────────────────────────────────

type Action =
  | { type: "add-ghost-lesson"; sectionId: string; title: string }
  | { type: "delete-lesson"; sectionId: string; lessonId: string }
  | { type: "realize-lesson"; sectionId: string; lessonId: string }
  | {
      type: "reorder-lessons";
      sectionId: string;
      lessonIds: string[];
    }
  | {
      type: "toggle-icon";
      sectionId: string;
      lessonId: string;
    }
  | {
      type: "toggle-priority";
      sectionId: string;
      lessonId: string;
    }
  | {
      type: "update-description";
      sectionId: string;
      lessonId: string;
      description: string;
    }
  | {
      type: "update-dependencies";
      sectionId: string;
      lessonId: string;
      dependencies: string[];
    }
  | {
      type: "update-title";
      sectionId: string;
      lessonId: string;
      title: string;
    }
  | { type: "add-ghost-section"; title: string };

function sectionsReducer(sections: Section[], action: Action): Section[] {
  switch (action.type) {
    case "add-ghost-lesson": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        const maxOrder = Math.max(0, ...s.lessons.map((l) => l.order));
        const newLesson: Lesson = {
          id: `l${Date.now()}`,
          title: action.title,
          order: maxOrder + 1,
          fsStatus: "ghost",
          description: "",
          icon: "watch",
          priority: 2,
          dependencies: [],
        };
        return { ...s, lessons: [...s.lessons, newLesson] };
      });
    }
    case "delete-lesson": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.filter((l) => l.id !== action.lessonId),
        };
      });
    }
    case "realize-lesson": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) => {
            if (l.id !== action.lessonId) return l;
            return {
              ...l,
              fsStatus: "real" as const,
              videos: [],
            };
          }),
        };
      });
    }
    case "reorder-lessons": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        const lessonMap = new Map(s.lessons.map((l) => [l.id, l]));
        const reordered = action.lessonIds
          .map((id) => lessonMap.get(id))
          .filter(Boolean) as Lesson[];
        return {
          ...s,
          lessons: reordered.map((l, i) => ({ ...l, order: i + 1 })),
        };
      });
    }
    case "toggle-icon": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) => {
            if (l.id !== action.lessonId) return l;
            const next: LessonIcon =
              l.icon === "watch"
                ? "code"
                : l.icon === "code"
                  ? "discussion"
                  : "watch";
            return { ...l, icon: next };
          }),
        };
      });
    }
    case "toggle-priority": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) => {
            if (l.id !== action.lessonId) return l;
            const next: LessonPriority =
              l.priority === 1 ? 2 : l.priority === 2 ? 3 : 1;
            return { ...l, priority: next };
          }),
        };
      });
    }
    case "update-description": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) =>
            l.id === action.lessonId
              ? { ...l, description: action.description }
              : l
          ),
        };
      });
    }
    case "update-dependencies": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) =>
            l.id === action.lessonId
              ? { ...l, dependencies: action.dependencies }
              : l
          ),
        };
      });
    }
    case "update-title": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) =>
            l.id === action.lessonId ? { ...l, title: action.title } : l
          ),
        };
      });
    }
    case "add-ghost-section": {
      const maxOrder = Math.max(0, ...sections.map((s) => s.order));
      return [
        ...sections,
        {
          id: `s${Date.now()}`,
          title: action.title,
          order: maxOrder + 1,
          lessons: [],
        },
      ];
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface FlatLesson {
  id: string;
  number: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  sectionNumber: number;
  priority: LessonPriority;
}

function flattenLessons(sections: Section[]): FlatLesson[] {
  const result: FlatLesson[] = [];
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  sorted.forEach((section, si) => {
    const sortedLessons = [...section.lessons].sort(
      (a, b) => a.order - b.order
    );
    sortedLessons.forEach((lesson, li) => {
      result.push({
        id: lesson.id,
        number: `${si + 1}.${li + 1}`,
        title: lesson.title,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionNumber: si + 1,
        priority: lesson.priority,
      });
    });
  });
  return result;
}

function checkDependencyViolation(
  lesson: Lesson,
  allLessons: FlatLesson[]
): FlatLesson[] {
  const violations: FlatLesson[] = [];
  const lessonIndex = allLessons.findIndex((l) => l.id === lesson.id);
  for (const depId of lesson.dependencies) {
    const depIndex = allLessons.findIndex((l) => l.id === depId);
    if (depIndex > lessonIndex) {
      const dep = allLessons[depIndex];
      if (dep) violations.push(dep);
    }
  }
  return violations;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function sectionIsGhost(section: Section): boolean {
  return (
    section.lessons.length === 0 ||
    section.lessons.every((l) => l.fsStatus === "ghost")
  );
}

// ─── Components ─────────────────────────────────────────────────────────────

function LessonIconBadge({
  icon,
  fsStatus,
  onClick,
}: {
  icon: LessonIcon;
  fsStatus: FsStatus;
  onClick: () => void;
}) {
  const colors =
    icon === "code"
      ? "bg-yellow-500/20 text-yellow-600"
      : icon === "discussion"
        ? "bg-green-500/20 text-green-600"
        : "bg-purple-500/20 text-purple-600";

  return (
    <button
      className={cn(
        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
        colors,
        fsStatus === "ghost" && "opacity-50"
      )}
      onClick={onClick}
      title={
        icon === "code"
          ? "Interactive (click to change)"
          : icon === "discussion"
            ? "Discussion (click to change)"
            : "Watch (click to change)"
      }
    >
      {icon === "code" ? (
        <Code className="w-3.5 h-3.5" />
      ) : icon === "discussion" ? (
        <MessageCircle className="w-3.5 h-3.5" />
      ) : (
        <Play className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

function PriorityBadge({
  priority,
  onClick,
}: {
  priority: LessonPriority;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex-shrink-0 text-xs px-2 py-0.5 rounded-sm font-medium",
        priority === 1
          ? "bg-red-500/20 text-red-600"
          : priority === 3
            ? "bg-sky-500/20 text-sky-500"
            : "bg-yellow-500/20 text-yellow-600"
      )}
      onClick={onClick}
      title="Click to toggle priority (P1 > P2 > P3)"
    >
      P{priority}
    </button>
  );
}

function FsStatusBadge({ fsStatus }: { fsStatus: FsStatus }) {
  if (fsStatus === "real") return null;
  return (
    <span className="flex items-center text-xs text-muted-foreground/60 px-1 py-0.5 rounded-sm bg-muted/50">
      <Ghost className="w-3 h-3" />
    </span>
  );
}

// ─── Dependency Selector (inline) ───────────────────────────────────────────

function InlineDependencySelector({
  lessonId,
  dependencies,
  allLessons,
  violations,
  onDependenciesChange,
}: {
  lessonId: string;
  dependencies: string[];
  allLessons: FlatLesson[];
  violations: FlatLesson[];
  onDependenciesChange: (deps: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const hasViolation = violations.length > 0;
  const hasDeps = dependencies.length > 0;

  const toggle = (id: string) => {
    if (dependencies.includes(id)) {
      onDependenciesChange(dependencies.filter((d) => d !== id));
    } else {
      onDependenciesChange([...dependencies, id]);
    }
  };

  const sections = allLessons.reduce<
    Map<string, { title: string; number: number; lessons: FlatLesson[] }>
  >((acc, lesson) => {
    if (lesson.id === lessonId) return acc;
    if (
      search &&
      !lesson.title.toLowerCase().includes(search.toLowerCase()) &&
      !lesson.number.includes(search)
    )
      return acc;
    if (!acc.has(lesson.sectionId)) {
      acc.set(lesson.sectionId, {
        title: lesson.sectionTitle,
        number: lesson.sectionNumber,
        lessons: [],
      });
    }
    acc.get(lesson.sectionId)!.lessons.push(lesson);
    return acc;
  }, new Map());

  return (
    <div className="relative">
      <button
        className={cn(
          "text-xs flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted",
          hasViolation
            ? "bg-amber-500/20 text-amber-600"
            : "text-muted-foreground hover:text-foreground"
        )}
        title={
          hasViolation
            ? `Order violation: depends on later lessons (${violations.map((v) => v.number).join(", ")})`
            : undefined
        }
        onClick={() => setOpen(!open)}
      >
        <Link2 className="w-3 h-3" />
        {hasDeps && (
          <>
            {dependencies
              .map((id) => allLessons.find((l) => l.id === id)?.number)
              .filter(Boolean)
              .join(", ")}
            {hasViolation && <AlertTriangle className="w-3 h-3" />}
          </>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-popover border rounded-md shadow-md z-50">
          <div className="p-2 border-b">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search lessons..."
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto max-h-[300px] p-1">
            {Array.from(sections.entries()).map(([sectionId, section]) => (
              <div key={sectionId}>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {section.number}. {section.title}
                </div>
                {section.lessons.map((l) => (
                  <label
                    key={l.id}
                    className="flex items-center gap-2 px-2 pl-4 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={dependencies.includes(l.id)}
                      onCheckedChange={() => toggle(l.id)}
                    />
                    <span className="text-muted-foreground w-7 text-right shrink-0">
                      {l.number}
                    </span>
                    <span className="truncate">{l.title}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sortable Lesson ────────────────────────────────────────────────────────

function SortableLessonItem({
  lesson,
  lessonIndex,
  section,
  allFlatLessons,
  dispatch,
}: {
  lesson: Lesson;
  lessonIndex: number;
  section: Section;
  allFlatLessons: FlatLesson[];
  dispatch: React.Dispatch<Action>;
}) {
  const [editingDesc, setEditingDesc] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(lesson.title);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lesson.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const violations = checkDependencyViolation(lesson, allFlatLessons);
  const sectionIndex =
    allFlatLessons.find((l) => l.sectionId === section.id)?.sectionNumber ?? 1;
  const lessonNumber = `${sectionIndex}.${lessonIndex + 1}`;
  const isGhost = lesson.fsStatus === "ghost";

  return (
    <div ref={setNodeRef} style={style}>
      {lessonIndex > 0 && <Separator className="my-1" />}
      <div
        className={cn(
          "rounded-md px-2 py-2 group",
          isGhost &&
            "border border-dashed border-muted-foreground/30 bg-muted/20"
        )}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="cursor-context-menu">
              <div className="flex items-start gap-2">
                {/* Drag handle */}
                <button
                  className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 mt-1 touch-none"
                  {...attributes}
                  {...listeners}
                >
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                </button>

                {/* Icon badge */}
                <LessonIconBadge
                  icon={lesson.icon}
                  fsStatus={lesson.fsStatus}
                  onClick={() =>
                    dispatch({
                      type: "toggle-icon",
                      sectionId: section.id,
                      lessonId: lesson.id,
                    })
                  }
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {editingTitle ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          className="text-sm h-7"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              dispatch({
                                type: "update-title",
                                sectionId: section.id,
                                lessonId: lesson.id,
                                title: titleDraft,
                              });
                              setEditingTitle(false);
                            }
                            if (e.key === "Escape") {
                              setTitleDraft(lesson.title);
                              setEditingTitle(false);
                            }
                          }}
                          onBlur={() => {
                            dispatch({
                              type: "update-title",
                              sectionId: section.id,
                              lessonId: lesson.id,
                              title: titleDraft,
                            });
                            setEditingTitle(false);
                          }}
                        />
                      </div>
                    ) : (
                      <>
                        <span
                          className={cn(
                            "text-sm text-muted-foreground",
                            isGhost && "text-muted-foreground/50"
                          )}
                        >
                          {lessonNumber}
                        </span>
                        <span
                          className={cn(
                            "text-sm font-medium cursor-pointer hover:text-muted-foreground transition-colors",
                            isGhost && "text-muted-foreground/70 italic"
                          )}
                          onClick={() => {
                            setTitleDraft(lesson.title);
                            setEditingTitle(true);
                          }}
                        >
                          {lesson.title}
                        </span>
                      </>
                    )}

                    {!editingTitle && (
                      <>
                        <FsStatusBadge fsStatus={lesson.fsStatus} />
                        <InlineDependencySelector
                          lessonId={lesson.id}
                          dependencies={lesson.dependencies}
                          allLessons={allFlatLessons}
                          violations={violations}
                          onDependenciesChange={(deps) =>
                            dispatch({
                              type: "update-dependencies",
                              sectionId: section.id,
                              lessonId: lesson.id,
                              dependencies: deps,
                            })
                          }
                        />
                        <PriorityBadge
                          priority={lesson.priority}
                          onClick={() =>
                            dispatch({
                              type: "toggle-priority",
                              sectionId: section.id,
                              lessonId: lesson.id,
                            })
                          }
                        />
                      </>
                    )}
                  </div>

                  {/* Description */}
                  {editingDesc ? (
                    <div className="mt-2">
                      <Textarea
                        value={lesson.description}
                        onChange={(e) =>
                          dispatch({
                            type: "update-description",
                            sectionId: section.id,
                            lessonId: lesson.id,
                            description: e.target.value,
                          })
                        }
                        placeholder="What should this lesson teach?"
                        className="text-sm min-h-[60px]"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingDesc(false);
                          if (e.key === "Enter" && e.ctrlKey)
                            setEditingDesc(false);
                        }}
                        onBlur={() => setEditingDesc(false)}
                      />
                    </div>
                  ) : lesson.description ? (
                    <p
                      className="text-xs text-muted-foreground mt-1 cursor-pointer hover:text-foreground/70 transition-colors line-clamp-2"
                      onClick={() => setEditingDesc(true)}
                    >
                      {lesson.description}
                    </p>
                  ) : (
                    <button
                      className="text-xs text-muted-foreground/50 mt-1 hover:text-muted-foreground transition-colors"
                      onClick={() => setEditingDesc(true)}
                    >
                      + Add description
                    </button>
                  )}

                  {/* Videos for real lessons */}
                  {lesson.videos && lesson.videos.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {lesson.videos.map((video) => (
                        <div
                          key={video.id}
                          className="flex items-center justify-between text-xs py-0.5 px-2 rounded hover:bg-muted/50 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileVideo className="w-3 h-3 shrink-0 text-muted-foreground" />
                            <span className="truncate text-muted-foreground">
                              {video.path}
                            </span>
                          </div>
                          <span className="text-muted-foreground/70 font-mono ml-2 shrink-0">
                            {formatDuration(video.durationSeconds)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {isGhost && (
              <>
                <ContextMenuItem
                  onSelect={() =>
                    dispatch({
                      type: "realize-lesson",
                      sectionId: section.id,
                      lessonId: lesson.id,
                    })
                  }
                >
                  <BookOpen className="w-4 h-4" />
                  Create on Disk
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem
              onSelect={() => {
                setTitleDraft(lesson.title);
                setEditingTitle(true);
              }}
            >
              <BookOpen className="w-4 h-4" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setEditingDesc(true)}>
              <Plus className="w-4 h-4" />
              Edit Description
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() =>
                dispatch({
                  type: "delete-lesson",
                  sectionId: section.id,
                  lessonId: lesson.id,
                })
              }
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </div>
  );
}

// ─── Add Ghost Lesson Modal ─────────────────────────────────────────────────

function AddGhostLessonModal({
  sectionId,
  open,
  onOpenChange,
  dispatch,
}: {
  sectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dispatch: React.Dispatch<Action>;
}) {
  const [title, setTitle] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Ghost Lesson</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            dispatch({
              type: "add-ghost-lesson",
              sectionId,
              title: title.trim(),
            });
            setTitle("");
            onOpenChange(false);
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Understanding Generics"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTitle("");
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              <Ghost className="w-4 h-4 mr-2" />
              Add Ghost Lesson
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Ghost Section Modal ────────────────────────────────────────────────

function AddGhostSectionModal({
  open,
  onOpenChange,
  dispatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dispatch: React.Dispatch<Action>;
}) {
  const [title, setTitle] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Section</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            dispatch({ type: "add-ghost-section", title: title.trim() });
            setTitle("");
            onOpenChange(false);
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. 04-generics"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTitle("");
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Add Section
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function GhostLessonsPrototype() {
  const [sections, dispatch] = useReducer(sectionsReducer, INITIAL_SECTIONS);
  const [addGhostSectionId, setAddGhostSectionId] = useState<string | null>(
    null
  );
  const [showAddSection, setShowAddSection] = useState(false);

  const allFlatLessons = flattenLessons(sections);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (sectionId: string, lessons: Lesson[]) => (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = lessons.findIndex((l) => l.id === active.id);
      const newIndex = lessons.findIndex((l) => l.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const newOrder = arrayMove(
        lessons.map((l) => l.id),
        oldIndex,
        newIndex
      );
      dispatch({ type: "reorder-lessons", sectionId, lessonIds: newOrder });
    },
    []
  );

  const sortedSections = [...sections].sort((a, b) => a.order - b.order);

  // Stats
  const totalLessons = sections.reduce((acc, s) => acc + s.lessons.length, 0);
  const ghostCount = sections.reduce(
    (acc, s) => acc + s.lessons.filter((l) => l.fsStatus === "ghost").length,
    0
  );
  const realCount = totalLessons - ghostCount;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold">
              TypeScript Pro Essentials
              <span className="text-sm font-normal text-muted-foreground ml-3">
                prototype / ghost lessons
              </span>
            </h1>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddSection(true)}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Section
            </Button>
          </div>
          <div className="flex gap-3 text-sm text-muted-foreground">
            <span>{totalLessons} lessons</span>
            <span>
              <span className="text-foreground font-medium">{realCount}</span>{" "}
              real
            </span>
            <span>
              <span className="text-foreground font-medium">{ghostCount}</span>{" "}
              ghost
            </span>
          </div>
        </div>

        <div className="space-y-6">
          {/* Main course structure */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sortedSections.map((section) => {
              const isGhostSection = sectionIsGhost(section);
              const sortedLessons = [...section.lessons].sort(
                (a, b) => a.order - b.order
              );

              return (
                <div key={section.id} className="rounded-lg border bg-card">
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div className="px-4 py-3 border-b bg-muted/30 cursor-context-menu">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h2
                              className={cn(
                                "font-medium text-sm",
                                isGhostSection &&
                                  "text-muted-foreground/70 italic"
                              )}
                            >
                              {section.title}
                            </h2>
                            {isGhostSection && (
                              <Ghost className="w-3.5 h-3.5 text-muted-foreground/40" />
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[10px]">
                              {
                                section.lessons.filter(
                                  (l) => l.fsStatus === "real"
                                ).length
                              }
                              /{section.lessons.length}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => setAddGhostSectionId(section.id)}
                      >
                        <Ghost className="w-4 h-4" />
                        Add Ghost Lesson
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => setAddGhostSectionId(section.id)}
                      >
                        <Plus className="w-4 h-4" />
                        Add Lesson
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                  <AddGhostLessonModal
                    sectionId={section.id}
                    open={addGhostSectionId === section.id}
                    onOpenChange={(open) =>
                      setAddGhostSectionId(open ? section.id : null)
                    }
                    dispatch={dispatch}
                  />
                  <div className="p-2">
                    {sortedLessons.length === 0 ? (
                      <div className="py-6 text-center">
                        <Ghost className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                        <p className="text-xs text-muted-foreground/50">
                          Empty section
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 text-xs"
                          onClick={() => setAddGhostSectionId(section.id)}
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add ghost lesson
                        </Button>
                      </div>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd(section.id, sortedLessons)}
                      >
                        <SortableContext
                          items={sortedLessons.map((l) => l.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {sortedLessons.map((lesson, li) => (
                            <SortableLessonItem
                              key={lesson.id}
                              lesson={lesson}
                              lessonIndex={li}
                              section={section}
                              allFlatLessons={allFlatLessons}
                              dispatch={dispatch}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <AddGhostSectionModal
          open={showAddSection}
          onOpenChange={setShowAddSection}
          dispatch={dispatch}
        />
      </div>
    </div>
  );
}
