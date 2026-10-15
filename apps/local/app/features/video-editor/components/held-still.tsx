import { FilmIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Where a Clip's first-frame still goes while its take is still recording
 * (#2214): no still is decoded from the growing files until Stop.
 */
export const HeldStill = (props: { isPortrait: boolean; timecode: string }) => (
  <div
    className={cn(
      "flex-shrink-0 relative bg-muted rounded flex items-center justify-center",
      props.isPortrait ? "w-24 aspect-[9/16]" : "w-32 aspect-[16/9]"
    )}
    title="No still until Stop: its take is still recording"
  >
    <FilmIcon className="w-6 h-6 text-muted-foreground" />
    <div className="absolute top-1 right-1 text-xs px-1.5 py-0.5 rounded bg-black/60 text-white">
      {props.timecode}
    </div>
  </div>
);
