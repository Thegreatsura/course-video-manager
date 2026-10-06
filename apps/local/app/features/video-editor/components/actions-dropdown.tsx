import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import { ChevronDown, Loader2 } from "lucide-react";
import { usePublishEditorVideoMenu } from "../editor-video-menu";

/**
 * The editor's "Actions" button: the Video's menu, built by the panel from
 * `videoMenuGroups`. The same groups go to the breadcrumb's right-click, so
 * the two doors cannot drift.
 */
export const ActionsDropdown = (props: {
  videoId: string;
  groups: ActionMenuGroups;
  /** Whether silence detection has completed for all clips */
  allClipsHaveSilenceDetected: boolean;
  /** A long-running action (DaVinci Resolve export) is in flight. */
  isPending?: boolean;
}) => {
  usePublishEditorVideoMenu(props.groups);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                disabled={!props.allClipsHaveSilenceDetected}
              >
                {props.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : null}
                Actions
                <ChevronDown className="w-4 h-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        {!props.allClipsHaveSilenceDetected && (
          <TooltipContent>
            <p>Waiting for silence detection to complete</p>
          </TooltipContent>
        )}
      </Tooltip>
      <EntityMenuContent
        menu="dropdown"
        align="end"
        className="w-64"
        entity={{ type: "video", id: props.videoId }}
        groups={props.groups}
      />
    </DropdownMenu>
  );
};
