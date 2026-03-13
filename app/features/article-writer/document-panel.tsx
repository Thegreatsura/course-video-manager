import { lazy, memo, Suspense, useCallback, useRef, useState } from "react";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CopyIcon,
  SaveIcon,
  CheckIcon,
  ImageIcon,
  Loader2Icon,
  FileTextIcon,
  FileTypeIcon,
  PlusIcon,
  PencilIcon,
  EyeIcon,
  AlertTriangleIcon,
  TimerIcon,
} from "lucide-react";
import type { LintViolation } from "./lint-rules";
import type { Options } from "react-markdown";
import type { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

export interface DocumentPanelProps {
  document: string | undefined;
  fullPath: string;
  extraComponents?: Options["components"];
  preprocessMarkdown?: (md: string) => string;
  onDocumentChange?: (content: string) => void;
  isCopied?: boolean;
  onCopyAsMarkdown?: () => void;
  onCopyAsRichText?: () => void;
  isStandalone?: boolean;
  hasExplainerOrProblem?: boolean;
  writeToReadmeFetcherState?: "idle" | "submitting" | "loading";
  hasUnresolvedScreenshots?: boolean;
  onWriteToReadme?: (mode: "write" | "append") => void;
  isUploadingImages?: boolean;
  onUploadImages?: () => void;
  violations?: LintViolation[];
  onFixLintViolations?: () => void;
  isStreaming?: boolean;
  sessionTimer?: string;
}

export const DocumentPanel = memo(function DocumentPanel({
  document,
  fullPath,
  extraComponents,
  preprocessMarkdown,
  onDocumentChange,
  isCopied,
  onCopyAsMarkdown,
  onCopyAsRichText,
  isStandalone,
  hasExplainerOrProblem,
  writeToReadmeFetcherState,
  hasUnresolvedScreenshots,
  onWriteToReadme,
  isUploadingImages,
  onUploadImages,
  violations,
  onFixLintViolations,
  isStreaming,
  sessionTimer,
}: DocumentPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;

  const handleEditorMount = useCallback<OnMount>((editor, monaco) => {
    // Register Prettier as Monaco's native document formatter for Markdown
    monaco.languages.registerDocumentFormattingEditProvider("markdown", {
      provideDocumentFormattingEdits: async (
        model: Monaco.editor.ITextModel
      ) => {
        try {
          const [prettier, markdownPlugin] = await Promise.all([
            import("prettier/standalone"),
            import("prettier/plugins/markdown"),
          ]);
          const formatted = await prettier.format(model.getValue(), {
            parser: "markdown",
            plugins: [markdownPlugin.default],
            proseWrap: "preserve",
            tabWidth: 2,
          });
          return [
            {
              text: formatted,
              range: model.getFullModelRange(),
            },
          ];
        } catch {
          return [];
        }
      },
    });

    // Ctrl+S / Cmd+S: format with Prettier then notify parent
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      const formatAction = editor.getAction("editor.action.formatDocument");
      if (formatAction) {
        await formatAction.run();
        onDocumentChangeRef.current?.(editor.getValue());
      }
    });
  }, []);

  if (!document) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>No document yet. Send a message to generate one.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-1 px-4 py-2 border-b">
        {/* Copy dropdown */}
        <DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!document || hasUnresolvedScreenshots}
                  >
                    {isCopied ? (
                      <CheckIcon className="h-4 w-4" />
                    ) : (
                      <CopyIcon className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isCopied ? "Copied" : "Copy document"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={onCopyAsMarkdown}>
              <FileTextIcon className="h-4 w-4 mr-2" />
              Copy as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCopyAsRichText}>
              <FileTypeIcon className="h-4 w-4 mr-2" />
              Copy as Rich Text
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Readme dropdown */}
        {!isStandalone && onWriteToReadme && (
          <DropdownMenu>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={
                        !hasExplainerOrProblem ||
                        !document ||
                        hasUnresolvedScreenshots ||
                        writeToReadmeFetcherState === "submitting" ||
                        writeToReadmeFetcherState === "loading"
                      }
                    >
                      {writeToReadmeFetcherState === "submitting" ||
                      writeToReadmeFetcherState === "loading" ? (
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                      ) : (
                        <SaveIcon className="h-4 w-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {!hasExplainerOrProblem
                      ? "No explainer or problem folder"
                      : "Save to README"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => onWriteToReadme("write")}>
                <SaveIcon className="h-4 w-4 mr-2" />
                Write to README
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onWriteToReadme("append")}>
                <PlusIcon className="h-4 w-4 mr-2" />
                Append to README
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Upload images to Cloudinary */}
        {onUploadImages && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onUploadImages}
                  disabled={isUploadingImages || !document?.trim()}
                >
                  {isUploadingImages ? (
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {isUploadingImages
                    ? "Uploading images..."
                    : "Upload images to Cloudinary"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Lint violations */}
        {violations && violations.length > 0 && onFixLintViolations && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={onFixLintViolations}
                  disabled={isStreaming}
                >
                  <AlertTriangleIcon className="h-4 w-4 mr-1 text-orange-500" />
                  Fix ({violations.reduce((sum, v) => sum + v.count, 0)})
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1">
                  <p className="font-semibold">Lint Violations:</p>
                  {violations.map((v) => (
                    <p key={v.rule.id} className="text-sm">
                      • {v.rule.name}: {v.count} issue
                      {v.count > 1 ? "s" : ""}
                    </p>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <div className="flex-1" />

        {/* Session timer */}
        {sessionTimer && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums mr-2">
            <TimerIcon className="h-3 w-3" />
            {sessionTimer}
          </span>
        )}

        {/* Edit / Preview toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsEditing(!isEditing)}
        >
          {isEditing ? (
            <>
              <EyeIcon className="h-4 w-4 mr-1" />
              Preview
            </>
          ) : (
            <>
              <PencilIcon className="h-4 w-4 mr-1" />
              Edit
            </>
          )}
        </Button>
      </div>
      {isEditing ? (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Loading editor…
            </div>
          }
        >
          <MonacoEditor
            height="100%"
            defaultLanguage="markdown"
            value={document}
            onChange={(value) => onDocumentChange?.(value ?? "")}
            onMount={handleEditorMount}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              wordWrap: "on",
              lineNumbers: "off",
              fontSize: 14,
              padding: { top: 16, bottom: 16 },
              scrollBeyondLastLine: true,
            }}
          />
        </Suspense>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-gray-700 hover:scrollbar-thumb-gray-600 p-6">
          <div className="max-w-[75ch] mx-auto">
            <AIResponse
              imageBasePath={fullPath}
              extraComponents={extraComponents}
              preprocessMarkdown={preprocessMarkdown}
            >
              {document}
            </AIResponse>
          </div>
        </div>
      )}
    </div>
  );
});
