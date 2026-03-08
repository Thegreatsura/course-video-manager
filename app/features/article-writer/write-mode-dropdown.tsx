import { Button } from "@/components/ui/button";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  FileTextIcon,
  ListChecksIcon,
  VideoIcon,
  MicIcon,
  CrosshairIcon,
} from "lucide-react";
import { useState } from "react";
import type { Mode } from "./types";
import { modeToLabel, loadRecentModes, saveRecentMode } from "./write-utils";

export function WriteModeDropdown(props: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}) {
  const { mode, onModeChange } = props;
  const [recentModes, setRecentModes] = useState<Mode[]>(loadRecentModes);

  const handleModeChange = (newMode: Mode) => {
    saveRecentMode(newMode);
    setRecentModes(loadRecentModes());
    onModeChange(newMode);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="justify-between min-w-[180px]">
          {modeToLabel[mode]}
          <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {recentModes.length > 0 && (
          <>
            <DropdownMenuLabel>Recent</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => handleModeChange(value as Mode)}
            >
              {recentModes.map((recentMode) => (
                <DropdownMenuRadioItem key={recentMode} value={recentMode}>
                  {modeToLabel[recentMode]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {/* Writing */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FileTextIcon className="h-4 w-4 mr-2" />
            Writing
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => handleModeChange(value as Mode)}
            >
              <DropdownMenuRadioItem value="article">
                <div>
                  <div>Article</div>
                  <div className="text-xs text-muted-foreground">
                    Educational content and explanations
                  </div>
                </div>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="article-plan">
                <div>
                  <div>Article Plan</div>
                  <div className="text-xs text-muted-foreground">
                    Plan structure with concise bullet points
                  </div>
                </div>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="newsletter">
                <div>
                  <div>Newsletter</div>
                  <div className="text-xs text-muted-foreground">
                    Friendly preview for AI Hero audience
                  </div>
                </div>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Exercise Steps */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ListChecksIcon className="h-4 w-4 mr-2" />
            Exercise Steps
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => handleModeChange(value as Mode)}
            >
              <DropdownMenuRadioItem value="project">
                <div>
                  <div>Project Steps</div>
                  <div className="text-xs text-muted-foreground">
                    Write steps for project
                  </div>
                </div>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="skill-building">
                <div>
                  <div>Skill Building Steps</div>
                  <div className="text-xs text-muted-foreground">
                    Write steps for skill building problem
                  </div>
                </div>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="style-guide-skill-building">
                <div>
                  <div>Style Guide - Skill Building</div>
                  <div className="text-xs text-muted-foreground">
                    Refine existing skill-building steps
                  </div>
                </div>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="style-guide-project">
                <div>
                  <div>Style Guide - Project</div>
                  <div className="text-xs text-muted-foreground">
                    Refine existing project steps
                  </div>
                </div>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* YouTube & SEO */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <VideoIcon className="h-4 w-4 mr-2" />
            YouTube & SEO
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => handleModeChange(value as Mode)}
            >
              <DropdownMenuRadioItem value="youtube-title">
                <div>
                  <div>YouTube Title</div>
                  <div className="text-xs text-muted-foreground">
                    Generate engaging video title
                  </div>
                </div>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="youtube-thumbnail">
                <div>
                  <div>YouTube Thumbnail</div>
                  <div className="text-xs text-muted-foreground">
                    Generate thumbnail description
                  </div>
                </div>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="youtube-description">
                <div>
                  <div>YouTube Description</div>
                  <div className="text-xs text-muted-foreground">
                    Generate description with timestamps
                  </div>
                </div>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="seo-description">
                <div>
                  <div>SEO Description</div>
                  <div className="text-xs text-muted-foreground">
                    Generate SEO description (max 160 chars)
                  </div>
                </div>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Planning */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CrosshairIcon className="h-4 w-4 mr-2" />
            Planning
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => handleModeChange(value as Mode)}
            >
              <DropdownMenuRadioItem value="brainstorming">
                <div>
                  <div>Brainstorming</div>
                  <div className="text-xs text-muted-foreground">
                    Explore ideas with an AI facilitator
                  </div>
                </div>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="scoping-discussion">
                <div>
                  <div>Scoping Discussion</div>
                  <div className="text-xs text-muted-foreground">
                    Open-ended discussion to scope a lesson
                  </div>
                </div>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="scoping-document">
                <div>
                  <div>Scoping Document</div>
                  <div className="text-xs text-muted-foreground">
                    Generate concise scoping document
                  </div>
                </div>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Interview */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <MicIcon className="h-4 w-4 mr-2" />
            Interview
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => handleModeChange(value as Mode)}
            >
              <DropdownMenuRadioItem value="interview-prep">
                <div>
                  <div>Interview Me</div>
                  <div className="text-xs text-muted-foreground">
                    Pre-interview chat, then go live
                  </div>
                </div>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
