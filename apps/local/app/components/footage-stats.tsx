import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDuration, formatHoursMinutes } from "@/lib/format-duration";
import type { FootageStats as FootageStatsData } from "@cvm/core/services/db-footage-stats.server";
import { Film } from "lucide-react";
import { Fragment } from "react";

const BLOCK_CLASS =
  "flex items-start gap-3 pt-3 mt-3 border-t text-xs leading-4 text-muted-foreground tabular-nums whitespace-nowrap cursor-default";

/**
 * How much Footage was filmed today, in the last 7 and in the last 30
 * calendar days, pinned to the foot of the app sidebar: one row per window,
 * in columns. Rounded to minutes; the tooltip gives the exact totals. Each
 * value is followed, quietly, by that window's efficiency: the share of its
 * Clips not archived, left out when it has no Clips. With no numbers (the
 * read failed) the block keeps its place with dashes.
 */
export function FootageStats({ stats }: { stats: FootageStatsData | null }) {
  if (!stats) return <StatsBlock windows={null} />;

  const windows: Window[] = [
    {
      label: "1D",
      title: "Today",
      seconds: stats.todaySeconds,
      clips: stats.todayClips,
      keptClips: stats.todayKeptClips,
    },
    {
      label: "7D",
      title: "Last 7 days",
      seconds: stats.last7DaysSeconds,
      clips: stats.last7DaysClips,
      keptClips: stats.last7DaysKeptClips,
    },
    {
      label: "30D",
      title: "Last 30 days",
      seconds: stats.last30DaysSeconds,
      clips: stats.last30DaysClips,
      keptClips: stats.last30DaysKeptClips,
    },
  ];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <StatsBlock windows={windows} />
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        <div className="font-medium mb-1">Footage filmed</div>
        {windows.map((w) => {
          const percent = efficiency(w);
          return (
            <div key={w.label} className="tabular-nums">
              {w.title}: {formatDuration(w.seconds)}
              {percent !== null &&
                ` · ${percent}% efficient (${w.keptClips} of ${w.clips} Clips not archived)`}
            </div>
          );
        })}
      </TooltipContent>
    </Tooltip>
  );
}

interface Window {
  readonly label: "1D" | "7D" | "30D";
  readonly title: string;
  readonly seconds: number;
  readonly clips: number;
  readonly keptClips: number;
}

const LABELS = ["1D", "7D", "30D"] as const;

/** A window's kept Clips as a whole percentage of all of its Clips; null with none. */
function efficiency(w: Window): number | null {
  if (w.clips === 0) return null;
  return Math.round((w.keptClips / w.clips) * 100);
}

function StatsBlock({
  windows,
  ...props
}: { windows: readonly Window[] | null } & React.ComponentProps<"div">) {
  return (
    <div {...props} className={BLOCK_CLASS} aria-label="Footage filmed">
      <Film className="w-3.5 h-3.5 shrink-0 mt-px" />
      <div className="grid grid-cols-[auto_auto_auto] gap-x-1.5 items-baseline">
        {LABELS.map((label, i) => {
          const w = windows?.[i];
          const percent = w ? efficiency(w) : null;
          return (
            <Fragment key={label}>
              <span className="text-[10px] tracking-wide text-muted-foreground/70">
                {label}
              </span>
              <span className="text-right text-foreground/75">
                {w ? formatHoursMinutes(w.seconds) : "–"}
              </span>
              <span className="text-right text-muted-foreground/70">
                {percent !== null && `${percent}%`}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
