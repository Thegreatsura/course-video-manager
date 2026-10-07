import { deepLinkAnchor } from "@/features/entity-links/use-deep-link-focus";
import { useState } from "react";
import { useFetcher } from "react-router";
import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  ActionMenuContent,
  EntityMenuContent,
} from "@/features/action-menu/action-menu";
import { useConfirmDialog } from "@/features/action-menu/confirm-dialog";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleDashedIcon,
  ReplaceIcon,
  XIcon,
} from "lucide-react";
import {
  PITCH_STATE_ORDER,
  PITCH_STATE_META,
} from "@/components/status-icon-badge";
import {
  CourseBadge,
  PitchBadge,
  type LinkedCourse,
  type LinkedPitch,
} from "./deliverable-links";
import {
  DeliverableForm,
  type CourseOption,
  type PitchOption,
} from "./deliverable-form";

export interface DeliverableForCard {
  id: string;
  title: string;
  notes: string | null;
  date: string;
  status: "planned" | "done" | "cancelled";
  linkedCourses: LinkedCourse[];
  linkedPitches: LinkedPitch[];
}

const STATUSES = [
  { status: "planned", label: "Planned", icon: CircleDashedIcon },
  { status: "done", label: "Done", icon: CheckIcon },
  { status: "cancelled", label: "Cancelled", icon: XIcon },
] as const;

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function CourseContextMenu({
  course,
  d,
  allCourses,
  submitLinkUpdate,
}: {
  course: LinkedCourse;
  d: DeliverableForCard;
  allCourses: CourseOption[];
  submitLinkUpdate: (courseIds: string[], pitchIds: string[]) => void;
}) {
  const pitchIds = d.linkedPitches.map((lp) => lp.id);
  const linked = (id: string) =>
    id !== course.id && d.linkedCourses.some((lc) => lc.id === id);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="cursor-context-menu">
        <CourseBadge course={course} />
      </ContextMenuTrigger>
      <EntityMenuContent
        menu="context"
        entity={{ type: "course", id: course.id }}
        groups={{
          edit: [
            {
              label: "Change Course",
              icon: ReplaceIcon,
              value: course.id,
              onValueChange: (newId) =>
                submitLinkUpdate(
                  d.linkedCourses.map((lc) =>
                    lc.id === course.id ? newId : lc.id
                  ),
                  pitchIds
                ),
              options: allCourses
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((co) => ({
                  value: co.id,
                  label: co.name,
                  disabled: linked(co.id),
                })),
            },
          ],
          danger: [
            {
              ...STANDARD_ACTIONS.removeFrom,
              label: "Remove from Deliverable",
              onSelect: () =>
                submitLinkUpdate(
                  d.linkedCourses
                    .filter((lc) => lc.id !== course.id)
                    .map((lc) => lc.id),
                  pitchIds
                ),
            },
          ],
        }}
      />
    </ContextMenu>
  );
}

function PitchContextMenu({
  pitch,
  d,
  allPitches,
  submitLinkUpdate,
}: {
  pitch: LinkedPitch;
  d: DeliverableForCard;
  allPitches: PitchOption[];
  submitLinkUpdate: (courseIds: string[], pitchIds: string[]) => void;
}) {
  const courseIds = d.linkedCourses.map((lc) => lc.id);
  const linked = (id: string) =>
    id !== pitch.id && d.linkedPitches.some((lp) => lp.id === id);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="cursor-context-menu">
        <PitchBadge pitch={pitch} />
      </ContextMenuTrigger>
      <EntityMenuContent
        menu="context"
        entity={{ type: "pitch", id: pitch.id }}
        groups={{
          edit: [
            {
              label: "Change Pitch",
              icon: ReplaceIcon,
              value: pitch.id,
              onValueChange: (newId) =>
                submitLinkUpdate(
                  courseIds,
                  d.linkedPitches.map((lp) =>
                    lp.id === pitch.id ? newId : lp.id
                  )
                ),
              options: PITCH_STATE_ORDER.flatMap((state) =>
                allPitches
                  .filter((ap) => ap.state === state)
                  .sort((a, b) =>
                    a.priority !== b.priority
                      ? a.priority - b.priority
                      : a.title.localeCompare(b.title)
                  )
                  .map((ap) => ({
                    value: ap.id,
                    label: ap.title,
                    tag: `P${ap.priority}`,
                    heading: PITCH_STATE_META[state].label,
                    disabled: linked(ap.id),
                  }))
              ),
            },
          ],
          danger: [
            {
              ...STANDARD_ACTIONS.removeFrom,
              label: "Remove from Deliverable",
              onSelect: () =>
                submitLinkUpdate(
                  courseIds,
                  d.linkedPitches
                    .filter((lp) => lp.id !== pitch.id)
                    .map((lp) => lp.id)
                ),
            },
          ],
        }}
      />
    </ContextMenu>
  );
}

export function DeliverableCard({
  d,
  todayStr,
  overdueCutoffStr,
  allCourses,
  allPitches,
  onAddNewForDate,
}: {
  d: DeliverableForCard;
  todayStr: string;
  /** YYYY-MM-DD cutoff — items with date < this are treated as overdue. Defaults to todayStr. */
  overdueCutoffStr?: string;
  allCourses: CourseOption[];
  allPitches: PitchOption[];
  onAddNewForDate?: (dateStr: string) => void;
}) {
  overdueCutoffStr ??= todayStr;
  const [editing, setEditing] = useState(false);
  const linkFetcher = useFetcher();
  const statusFetcher = useFetcher();
  const archiveFetcher = useFetcher();
  const duplicateFetcher = useFetcher();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  function submitLinkUpdate(courseIds: string[], pitchIds: string[]) {
    const fd = new FormData();
    fd.set("title", d.title);
    fd.set("date", d.date);
    fd.set("notes", d.notes ?? "");
    fd.set("status", d.status);
    for (const id of courseIds) fd.append("courseIds", id);
    for (const id of pitchIds) fd.append("pitchIds", id);
    linkFetcher.submit(fd, {
      method: "post",
      action: `/api/deliverables/${d.id}/update`,
    });
  }

  if (editing) {
    return (
      <li>
        <DeliverableForm
          d={d}
          onClose={() => setEditing(false)}
          allCourses={allCourses}
          allPitches={allPitches}
        />
      </li>
    );
  }

  const day = parseDate(d.date);
  const overdue = d.status === "planned" && d.date < overdueCutoffStr;
  const cancelled = d.status === "cancelled";
  const done = d.status === "done";

  const setStatus = (status: "planned" | "done" | "cancelled") => {
    const fd = new FormData();
    fd.set("status", status);
    statusFetcher.submit(fd, {
      method: "post",
      action: `/api/deliverables/${d.id}/update-status`,
    });
  };

  const duplicate = () => {
    duplicateFetcher.submit(new FormData(), {
      method: "post",
      action: `/api/deliverables/${d.id}/duplicate`,
    });
  };

  const dayLabel = `${day.toLocaleDateString(undefined, { weekday: "short" })} ${day.getDate()}`;

  const dateArea = (
    <div className="w-12 shrink-0 text-center">
      <div className="text-[10px] uppercase text-muted-foreground">
        {day.toLocaleDateString(undefined, { weekday: "short" })}
      </div>
      <div
        className={cn(
          "text-xl leading-none font-medium tabular-nums",
          overdue && "text-red-600 dark:text-red-400"
        )}
      >
        {day.getDate()}
      </div>
    </div>
  );

  return (
    <>
      {confirmDialog}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <li
            {...deepLinkAnchor(d.id)}
            className={cn(
              "cursor-context-menu rounded-lg border bg-background p-3 flex items-start gap-3",
              overdue ? "border-red-500/50 bg-red-500/5" : "border-border",
              cancelled && "opacity-50"
            )}
          >
            {onAddNewForDate ? (
              <ContextMenu>
                <ContextMenuTrigger asChild>{dateArea}</ContextMenuTrigger>
                <ActionMenuContent
                  menu="context"
                  groups={{
                    create: [
                      {
                        ...STANDARD_ACTIONS.add,
                        label: `Add Deliverable on ${dayLabel}`,
                        opensDialog: true,
                        onSelect: () => onAddNewForDate(d.date),
                      },
                    ],
                  }}
                />
              </ContextMenu>
            ) : (
              dateArea
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {overdue && (
                  <AlertTriangleIcon className="size-3.5 text-red-600 dark:text-red-400 shrink-0" />
                )}
                {done && (
                  <CheckIcon className="size-3.5 text-muted-foreground shrink-0" />
                )}
                {cancelled && (
                  <XIcon className="size-3.5 text-muted-foreground shrink-0" />
                )}
                <span
                  className={cn(
                    "text-sm font-medium",
                    done && "text-muted-foreground",
                    cancelled && "line-through text-muted-foreground"
                  )}
                >
                  {d.title}
                </span>
                {overdue && (
                  <span className="text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400">
                    · Overdue
                  </span>
                )}
              </div>
              {d.notes && (
                <p className="text-xs text-muted-foreground mt-1">{d.notes}</p>
              )}
              {(d.linkedCourses.length > 0 || d.linkedPitches.length > 0) && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {d.linkedCourses.map((c) => (
                    <CourseContextMenu
                      key={c.id}
                      course={c}
                      d={d}
                      allCourses={allCourses}
                      submitLinkUpdate={submitLinkUpdate}
                    />
                  ))}
                  {d.linkedPitches.map((p) => (
                    <PitchContextMenu
                      key={p.id}
                      pitch={p}
                      d={d}
                      allPitches={allPitches}
                      submitLinkUpdate={submitLinkUpdate}
                    />
                  ))}
                </div>
              )}
            </div>
          </li>
        </ContextMenuTrigger>
        <EntityMenuContent
          menu="context"
          entity={{ type: "deliverable", id: d.id }}
          groups={{
            edit: [
              {
                ...STANDARD_ACTIONS.edit,
                opensDialog: true,
                onSelect: () => setEditing(true),
              },
              {
                label: "Set Status",
                icon: CircleDashedIcon,
                items: STATUSES.map(({ status, label, icon }) => ({
                  label,
                  icon,
                  checked: d.status === status,
                  onSelect: () => {
                    if (d.status !== status) setStatus(status);
                  },
                })),
              },
            ],
            create: [{ ...STANDARD_ACTIONS.duplicate, onSelect: duplicate }],
            danger: [
              {
                ...STANDARD_ACTIONS.delete,
                opensDialog: true,
                onSelect: () =>
                  confirm({
                    title: "Delete deliverable?",
                    description: `"${d.title}" will be removed from the calendar. This cannot be undone from the app.`,
                    confirmLabel: "Delete",
                    onConfirm: () =>
                      archiveFetcher.submit(new FormData(), {
                        method: "post",
                        action: `/api/deliverables/${d.id}/archive`,
                      }),
                  }),
              },
            ],
          }}
        />
      </ContextMenu>
    </>
  );
}
