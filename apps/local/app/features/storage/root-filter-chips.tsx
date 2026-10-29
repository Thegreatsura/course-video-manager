import { HardDrive } from "lucide-react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { withRootToggled, type RootChip } from "./root-filter";

/**
 * The Storage Root filter's toggle chips (#2431): one per location, all
 * shown by default. A click toggles the location in the URL, which the page
 * hears and filters by; nothing is scanned again.
 */
export function RootFilterChips({
  chips,
  labelOf,
  isOffline,
}: {
  chips: readonly RootChip[];
  labelOf: (location: string) => string;
  isOffline: (location: string) => boolean;
}) {
  const [, setSearchParams] = useSearchParams();
  if (chips.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-sm"
      data-testid="root-filter"
    >
      <span className="text-muted-foreground">Show</span>
      {chips.map((chip) => (
        <Button
          key={chip.location}
          variant={chip.shown ? "secondary" : "outline"}
          size="sm"
          className={chip.shown ? "" : "text-muted-foreground line-through"}
          aria-pressed={chip.shown}
          disabled={chip.disabled}
          title={
            isOffline(chip.location)
              ? `${chip.location} is Offline`
              : chip.disabled
                ? `Nothing on ${chip.location}`
                : `${chip.shown ? "Hide" : "Show"} ${chip.location}`
          }
          onClick={() =>
            setSearchParams(
              (params) => withRootToggled(params, chip.location),
              {
                replace: true,
                preventScrollReset: true,
              }
            )
          }
          data-testid="root-filter-chip"
        >
          <HardDrive className="w-4 h-4" />
          {labelOf(chip.location)}
          <span className="text-muted-foreground tabular-nums">
            {isOffline(chip.location) ? "Offline" : chip.items}
          </span>
        </Button>
      ))}
    </div>
  );
}
