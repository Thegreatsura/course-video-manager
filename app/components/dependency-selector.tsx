import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AlertTriangle, Link2 } from "lucide-react";

export interface DependencyLessonItem {
  id: string;
  number: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  sectionNumber: number;
}

interface DependencyOrderViolation {
  number: string;
}

interface DependencyPriorityViolation {
  number: string;
  priority: number;
}

interface DependencySelectorProps {
  lessonId: string;
  dependencies: string[];
  allLessons: DependencyLessonItem[];
  onDependenciesChange: (dependencies: string[]) => void;
  orderViolations: DependencyOrderViolation[];
  priorityViolations: DependencyPriorityViolation[];
  lessonPriority: number;
  dependencyMap: Record<string, string[]>;
}

function wouldCreateCycle(
  fromId: string,
  toId: string,
  depMap: Record<string, string[]>
): boolean {
  const visited = new Set<string>();
  const stack = [toId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of depMap[current] ?? []) {
      stack.push(dep);
    }
  }
  return false;
}

export function DependencySelector({
  lessonId,
  dependencies,
  allLessons,
  onDependenciesChange,
  orderViolations,
  priorityViolations,
  lessonPriority,
  dependencyMap,
}: DependencySelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSearch("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const hasOrderViolation = orderViolations.length > 0;
  const hasPriorityViolation = priorityViolations.length > 0;
  const hasAnyViolation = hasOrderViolation || hasPriorityViolation;
  const hasDependencies = dependencies.length > 0;

  const toggle = (id: string) => {
    if (dependencies.includes(id)) {
      onDependenciesChange(dependencies.filter((d) => d !== id));
    } else {
      onDependenciesChange([...dependencies, id]);
    }
  };

  // Group lessons by section, filtering out the current lesson and applying search
  const sections = allLessons.reduce<
    Map<
      string,
      { title: string; number: number; lessons: DependencyLessonItem[] }
    >
  >((acc, lesson) => {
    if (lesson.id === lessonId) return acc;
    if (
      search !== "" &&
      !lesson.title.toLowerCase().includes(search.toLowerCase()) &&
      !lesson.number.includes(search)
    ) {
      return acc;
    }
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

  const filteredSections = Array.from(sections.entries());

  const title =
    hasOrderViolation && hasPriorityViolation
      ? `Order violation: depends on later lessons (${orderViolations.map((v) => v.number).join(", ")}). Priority violation: P${lessonPriority} depends on lower priority lessons (${priorityViolations.map((v) => `${v.number} P${v.priority}`).join(", ")})`
      : hasOrderViolation
        ? `Order violation: depends on later lessons (${orderViolations.map((v) => v.number).join(", ")})`
        : hasPriorityViolation
          ? `Priority violation: P${lessonPriority} depends on lower priority lessons (${priorityViolations.map((v) => `${v.number} P${v.priority}`).join(", ")})`
          : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`text-xs flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted ${
            hasAnyViolation
              ? "bg-amber-500/20 text-amber-600"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title={title}
        >
          <Link2 className="w-3 h-3" />
          {hasDependencies && (
            <>
              {dependencies
                .map((id) => allLessons.find((l) => l.id === id)?.number)
                .filter(Boolean)
                .join(", ")}
              {hasAnyViolation && <AlertTriangle className="w-3 h-3" />}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="p-2 border-b">
          <Input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lessons..."
            className="h-8 text-sm"
          />
        </div>
        <div
          className="overflow-y-auto"
          style={{
            maxHeight: "var(--radix-popover-content-available-height, 300px)",
          }}
        >
          <div className="p-1">
            {filteredSections.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted-foreground text-center">
                No lessons found
              </div>
            ) : (
              filteredSections.map(([sectionId, section]) => (
                <div key={sectionId}>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {section.number}. {section.title}
                  </div>
                  {section.lessons.map((l) => {
                    const isCircular =
                      !dependencies.includes(l.id) &&
                      wouldCreateCycle(lessonId, l.id, dependencyMap);
                    return (
                      <label
                        key={l.id}
                        className={`flex items-center gap-2 px-2 pl-4 py-1.5 rounded text-sm ${
                          isCircular
                            ? "opacity-50 cursor-not-allowed"
                            : "hover:bg-muted cursor-pointer"
                        }`}
                        title={
                          isCircular
                            ? "Would create a circular dependency"
                            : undefined
                        }
                      >
                        <Checkbox
                          checked={dependencies.includes(l.id)}
                          onCheckedChange={() => toggle(l.id)}
                          disabled={isCircular}
                        />
                        <span className="text-muted-foreground w-7 text-right shrink-0">
                          {l.number}
                        </span>
                        <span className="truncate">{l.title}</span>
                        {isCircular && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            (circular)
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
