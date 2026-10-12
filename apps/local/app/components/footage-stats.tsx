import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDuration, formatHoursMinutes } from "@/lib/format-duration";
import type { FootageStats as FootageStatsData } from "@cvm/core/services/db-footage-stats.server";
import { Film } from "lucide-react";

const ROW_CLASS =
  "flex items-center gap-3 h-9 pt-3 mt-3 border-t text-xs text-muted-foreground tabular-nums whitespace-nowrap cursor-default";

/**
 * How much Footage was filmed today, in the last 7 and in the last 30
 * calendar days, pinned to the foot of the app sidebar. Rounded to minutes;
 * the tooltip gives the exact totals. Today's value is followed, quietly, by
 * today's efficiency: the share of today's Clips not archived. With no numbers (the read failed) the
 * row keeps its place with dashes.
 */
export function FootageStats({ stats }: { stats: FootageStatsData | null }) {
  if (!stats) return <StatsRow seconds={null} efficiency={null} />;

  const efficiency = todayEfficiency(stats);

  const windows = [
    { label: "1D", title: "Today", seconds: stats.todaySeconds },
    { label: "7D", title: "Last 7 days", seconds: stats.last7DaysSeconds },
    { label: "30D", title: "Last 30 days", seconds: stats.last30DaysSeconds },
  ];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <StatsRow
          seconds={windows.map((w) => w.seconds)}
          efficiency={efficiency}
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        <div className="font-medium mb-1">Footage filmed</div>
        {windows.map((w) => (
          <div key={w.label} className="tabular-nums">
            {w.title}: {formatDuration(w.seconds)}
          </div>
        ))}
        {efficiency !== null && (
          <div className="tabular-nums mt-1">
            Efficiency today: {efficiency}% ({stats.todayKeptClips} of{" "}
            {stats.todayClips} Clips not archived)
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

const LABELS = ["1D", "7D", "30D"] as const;

/** Today's kept Clips as a whole percentage of all of today's; null with none. */
function todayEfficiency(stats: FootageStatsData): number | null {
  if (stats.todayClips === 0) return null;
  return Math.round((stats.todayKeptClips / stats.todayClips) * 100);
}

function StatsRow({
  seconds,
  efficiency,
  ...props
}: {
  seconds: readonly number[] | null;
  efficiency: number | null;
} & React.ComponentProps<"div">) {
  return (
    <div {...props} className={ROW_CLASS} aria-label="Footage filmed">
      <Film className="w-3.5 h-3.5 shrink-0" />
      {LABELS.map((label, i) => (
        <span key={label} className="inline-flex items-baseline gap-1">
          <span className="text-[10px] tracking-wide text-muted-foreground/70">
            {label}
          </span>
          <span className="text-foreground/75">
            {seconds ? formatHoursMinutes(seconds[i]!) : "–"}
          </span>
          {i === 0 && efficiency !== null && (
            <span className="text-muted-foreground/70">({efficiency}%)</span>
          )}
        </span>
      ))}
    </div>
  );
}
