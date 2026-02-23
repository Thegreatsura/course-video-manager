"use client";

import { DBFunctionsService } from "@/services/db-service";
import { sortByOrder } from "@/lib/sort-by-order";
import { runtimeLive } from "@/services/layer";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import { Array as EffectArray, Console, Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { data, Link, useFetcher, useRevalidator } from "react-router";
import type { Route } from "./+types/videos.$videoId.post";
import path from "path";
import { FileSystem } from "@effect/platform";
import {
  VideoContextPanel,
  type CourseStructure,
} from "@/components/video-context-panel";
import {
  ALWAYS_EXCLUDED_DIRECTORIES,
  DEFAULT_CHECKED_EXTENSIONS,
  DEFAULT_UNCHECKED_PATHS,
} from "@/services/text-writing-agent";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { AddLinkModal } from "@/components/add-link-modal";
import { StandaloneFileManagementModal } from "@/components/standalone-file-management-modal";
import { StandaloneFilePasteModal } from "@/components/standalone-file-paste-modal";
import { DeleteStandaloneFileModal } from "@/components/delete-standalone-file-modal";
import { LessonFilePasteModal } from "@/components/lesson-file-paste-modal";
import {
  CheckCircle2Icon,
  CheckIcon,
  ImageIcon,
  Loader2Icon,
  SparklesIcon,
  UploadIcon,
  XCircleIcon,
  YoutubeIcon,
  UnplugIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const POST_TITLE_STORAGE_KEY = (videoId: string) => `post-title-${videoId}`;
const POST_DESCRIPTION_STORAGE_KEY = (videoId: string) =>
  `post-description-${videoId}`;
const YOUTUBE_VIDEO_ID_STORAGE_KEY = (videoId: string) =>
  `youtube-video-id-${videoId}`;

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const fs = yield* FileSystem.FileSystem;
    const video = yield* db.getVideoWithClipsById(videoId);

    // Check YouTube auth status
    const youtubeAuth = yield* db.getYoutubeAuth();
    const isYoutubeAuthenticated = youtubeAuth !== null;
    const globalLinks = yield* db.getLinks();

    // Load thumbnails for this video
    const videoThumbnails = yield* db.getThumbnailsByVideoId(videoId);

    const lesson = video.lesson;

    // Build transcript from clips and clip sections
    type ClipItem = { type: "clip"; order: string; text: string | null };
    type ClipSectionItem = {
      type: "clip-section";
      order: string;
      name: string;
    };

    const clipItems: ClipItem[] = video.clips.map((clip) => ({
      type: "clip" as const,
      order: clip.order,
      text: clip.text,
    }));

    const clipSectionItems: ClipSectionItem[] = video.clipSections.map(
      (section) => ({
        type: "clip-section" as const,
        order: section.order,
        name: section.name,
      })
    );

    const sortedItems = sortByOrder([...clipItems, ...clipSectionItems]);

    // Build formatted transcript with sections as H2 headers
    const transcriptParts: string[] = [];
    let currentParagraph: string[] = [];

    for (const item of sortedItems) {
      if (item.type === "clip-section") {
        if (currentParagraph.length > 0) {
          transcriptParts.push(currentParagraph.join(" "));
          currentParagraph = [];
        }
        transcriptParts.push(`## ${item.name}`);
      } else if (item.text) {
        currentParagraph.push(item.text);
      }
    }

    if (currentParagraph.length > 0) {
      transcriptParts.push(currentParagraph.join(" "));
    }

    const transcript = transcriptParts.join("\n\n").trim();
    const transcriptWordCount = transcript ? transcript.split(/\s+/).length : 0;

    // Calculate word count per section
    const sectionsWithWordCount: SectionWithWordCount[] = [];
    let currentSectionIndex = -1;

    for (const item of sortedItems) {
      if (item.type === "clip-section") {
        const section = video.clipSections.find((s) => s.order === item.order);
        if (section) {
          currentSectionIndex = sectionsWithWordCount.length;
          sectionsWithWordCount.push({
            id: section.id,
            name: item.name,
            order: item.order,
            wordCount: 0,
          });
        }
      } else if (item.text && currentSectionIndex >= 0) {
        const wordCount = item.text.split(/\s+/).length;
        sectionsWithWordCount[currentSectionIndex]!.wordCount += wordCount;
      }
    }

    // For standalone videos (no lesson), fetch standalone video files
    if (!lesson) {
      const standaloneVideoDir = getStandaloneVideoFilePath(videoId);
      const dirExists = yield* fs.exists(standaloneVideoDir);

      let standaloneFiles: Array<{
        path: string;
        size: number;
        defaultEnabled: boolean;
      }> = [];

      if (dirExists) {
        const filesInDirectory = yield* fs.readDirectory(standaloneVideoDir);

        standaloneFiles = yield* Effect.forEach(
          filesInDirectory,
          (filename) => {
            return Effect.gen(function* () {
              const filePath = getStandaloneVideoFilePath(videoId, filename);
              const stat = yield* fs.stat(filePath);

              if (stat.type !== "File") {
                return null;
              }

              const extension = path.extname(filename).slice(1);
              const defaultEnabled =
                DEFAULT_CHECKED_EXTENSIONS.includes(extension);

              return {
                path: filename,
                size: Number(stat.size),
                defaultEnabled,
              };
            });
          }
        ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
      }

      return {
        videoPath: video.path,
        files: standaloneFiles,
        isStandalone: true,
        transcriptWordCount,
        clipSections: sectionsWithWordCount,
        links: globalLinks,
        courseStructure: null as CourseStructure | null,
        isYoutubeAuthenticated,
        thumbnails: videoThumbnails,
      };
    }

    const repo = lesson.section.repoVersion.repo;
    const section = lesson.section;

    const lessonPath = path.join(repo.filePath, section.path, lesson.path);

    const allFilesInDirectory = yield* fs
      .readDirectory(lessonPath, {
        recursive: true,
      })
      .pipe(
        Effect.map((files) => files.map((file) => path.join(lessonPath, file)))
      );

    const filteredFiles = allFilesInDirectory.filter((filePath) => {
      return !ALWAYS_EXCLUDED_DIRECTORIES.some((excludedDir) =>
        filePath.includes(excludedDir)
      );
    });

    const filesWithMetadata = yield* Effect.forEach(
      filteredFiles,
      (filePath) => {
        return Effect.gen(function* () {
          const stat = yield* fs.stat(filePath);

          if (stat.type !== "File") {
            return null;
          }

          const relativePath = path.relative(lessonPath, filePath);
          const extension = path.extname(filePath).slice(1);

          const defaultEnabled =
            DEFAULT_CHECKED_EXTENSIONS.includes(extension) &&
            !DEFAULT_UNCHECKED_PATHS.some((uncheckedPath) =>
              relativePath.toLowerCase().includes(uncheckedPath.toLowerCase())
            );

          return {
            path: relativePath,
            size: Number(stat.size),
            defaultEnabled,
          };
        });
      }
    ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));

    // Fetch course structure for non-standalone videos
    const repoWithSections = yield* db.getRepoWithSectionsById(
      section.repoVersion.repoId
    );
    const matchingVersion = repoWithSections?.versions.find(
      (v) => v.id === section.repoVersion.id
    );
    const courseStructure: CourseStructure | null = matchingVersion
      ? {
          repoName: repoWithSections!.name,
          currentSectionPath: section.path,
          currentLessonPath: lesson.path,
          sections: matchingVersion.sections.map((s) => ({
            path: s.path,
            lessons: s.lessons.map((l) => ({ path: l.path })),
          })),
        }
      : null;

    return {
      videoPath: video.path,
      files: filesWithMetadata,
      isStandalone: false,
      transcriptWordCount,
      clipSections: sectionsWithWordCount,
      links: globalLinks,
      courseStructure,
      isYoutubeAuthenticated,
      thumbnails: videoThumbnails,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

const Video = (props: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.playbackRate = 1;
    }
  }, [props.src, ref.current]);

  return <video src={props.src} className="w-full" controls ref={ref} />;
};

export default function PostPage(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    isStandalone,
    transcriptWordCount,
    clipSections,
    links,
    courseStructure,
    isYoutubeAuthenticated,
    thumbnails,
  } = props.loaderData;

  // Title and description with localStorage persistence
  const [title, setTitle] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(POST_TITLE_STORAGE_KEY(videoId)) ?? "";
    }
    return "";
  });
  const [description, setDescription] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(POST_DESCRIPTION_STORAGE_KEY(videoId)) ?? "";
    }
    return "";
  });

  // Auto-save title and description to localStorage
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(POST_TITLE_STORAGE_KEY(videoId), title);
    }
  }, [title, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(POST_DESCRIPTION_STORAGE_KEY(videoId), description);
    }
  }, [description, videoId]);

  // Context panel state
  const [enabledFiles, setEnabledFiles] = useState<Set<string>>(() => {
    return new Set(files.filter((f) => f.defaultEnabled).map((f) => f.path));
  });
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [enabledSections, setEnabledSections] = useState<Set<string>>(() => {
    return new Set(clipSections.map((s) => s.id));
  });
  const [includeCourseStructure, setIncludeCourseStructure] = useState(false);

  // File preview modal state
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewFilePath, setPreviewFilePath] = useState<string>("");

  // Add link modal state
  const [isAddLinkModalOpen, setIsAddLinkModalOpen] = useState(false);

  // Delete link fetcher
  const deleteLinkFetcher = useFetcher();

  // Standalone file management state
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string>("");
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string>("");

  // Lesson file paste modal state
  const [isLessonPasteModalOpen, setIsLessonPasteModalOpen] = useState(false);

  // AI generation state
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);

  // Confirmation dialog state
  const [confirmOverwriteField, setConfirmOverwriteField] = useState<
    "title" | "description" | null
  >(null);
  const [pendingGeneratedText, setPendingGeneratedText] = useState<string>("");

  // Visibility state
  const [privacyStatus, setPrivacyStatus] = useState<"public" | "unlisted">(
    "unlisted"
  );

  // Upload state
  const hasStoredYoutubeVideoId =
    typeof localStorage !== "undefined" &&
    !!localStorage.getItem(YOUTUBE_VIDEO_ID_STORAGE_KEY(videoId));
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >(hasStoredYoutubeVideoId ? "success" : "idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string>("");
  const [youtubeVideoId, setYoutubeVideoId] = useState<string>(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(YOUTUBE_VIDEO_ID_STORAGE_KEY(videoId)) ?? "";
    }
    return "";
  });

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        YOUTUBE_VIDEO_ID_STORAGE_KEY(videoId),
        youtubeVideoId
      );
    }
  }, [youtubeVideoId, videoId]);

  // Thumbnail selection
  const [selectingThumbnailId, setSelectingThumbnailId] = useState<
    string | null
  >(null);
  const { revalidate } = useRevalidator();

  const handleSelectThumbnail = async (thumbnailId: string) => {
    const isCurrentlySelected = thumbnails.find(
      (t) => t.id === thumbnailId
    )?.selectedForUpload;

    setSelectingThumbnailId(thumbnailId);
    try {
      const endpoint = isCurrentlySelected ? "deselect" : "select";
      const response = await fetch(
        `/api/thumbnails/${thumbnailId}/${endpoint}`,
        { method: "POST" }
      );
      if (response.ok) {
        revalidate();
      }
    } finally {
      setSelectingThumbnailId(null);
    }
  };

  const generateContent = async (
    mode: "youtube-title" | "youtube-title-single" | "youtube-description"
  ) => {
    const transcriptEnabled =
      clipSections.length > 0 ? enabledSections.size > 0 : includeTranscript;

    const response = await fetch(`/api/videos/${videoId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        enabledFiles: Array.from(enabledFiles),
        includeTranscript: transcriptEnabled,
        enabledSections: Array.from(enabledSections),
        courseStructure:
          includeCourseStructure && courseStructure
            ? courseStructure
            : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to generate content");
    }

    const result = await response.json();
    return result.text as string;
  };

  const handleGenerateTitle = async () => {
    setIsGeneratingTitle(true);
    try {
      const generatedText = await generateContent("youtube-title-single");
      if (title.trim()) {
        // Show confirmation dialog
        setPendingGeneratedText(generatedText);
        setConfirmOverwriteField("title");
      } else {
        setTitle(generatedText);
      }
    } catch (error) {
      console.error("Failed to generate title:", error);
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  const handleGenerateDescription = async () => {
    setIsGeneratingDescription(true);
    try {
      const generatedText = await generateContent("youtube-description");
      if (description.trim()) {
        // Show confirmation dialog
        setPendingGeneratedText(generatedText);
        setConfirmOverwriteField("description");
      } else {
        setDescription(generatedText);
      }
    } catch (error) {
      console.error("Failed to generate description:", error);
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  const handleConfirmOverwrite = () => {
    if (confirmOverwriteField === "title") {
      setTitle(pendingGeneratedText);
    } else if (confirmOverwriteField === "description") {
      setDescription(pendingGeneratedText);
    }
    setConfirmOverwriteField(null);
    setPendingGeneratedText("");
  };

  const handleCancelOverwrite = () => {
    setConfirmOverwriteField(null);
    setPendingGeneratedText("");
  };

  const handleUpload = async () => {
    if (!title.trim() || !description.trim()) return;

    setUploadStatus("uploading");
    setUploadProgress(0);
    setUploadError("");

    let finalStatus: "success" | "error" | null = null;

    try {
      const response = await fetch(`/api/videos/${videoId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          privacyStatus,
        }),
      });

      if (!response.ok || !response.body) {
        setUploadStatus("error");
        setUploadError("Failed to start upload");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ") && eventType) {
            const eventData = JSON.parse(line.slice(6));
            if (eventType === "progress") {
              setUploadProgress(eventData.percentage);
            } else if (eventType === "complete") {
              setYoutubeVideoId(eventData.videoId);
              setUploadStatus("success");
              finalStatus = "success";
            } else if (eventType === "error") {
              setUploadStatus("error");
              setUploadError(eventData.message);
              finalStatus = "error";
            }
            eventType = "";
          }
        }
      }

      if (!finalStatus) {
        setUploadStatus("error");
        setUploadError("Upload connection closed unexpectedly");
      }
    } catch (error) {
      setUploadStatus("error");
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    }
  };

  const handleDisconnect = async () => {
    const response = await fetch("/api/auth/google/disconnect", {
      method: "POST",
    });
    if (response.ok) {
      // Reload to reflect disconnected state
      window.location.reload();
    }
  };

  const handleFileClick = (filePath: string) => {
    setPreviewFilePath(filePath);
    setIsPreviewModalOpen(true);
  };

  const handleEditFile = async (filename: string) => {
    try {
      const response = await fetch(
        `/api/standalone-files/read?videoId=${videoId}&filename=${encodeURIComponent(filename)}`
      );
      if (response.ok) {
        const content = await response.text();
        setSelectedFilename(filename);
        setSelectedFileContent(content);
        setIsFileModalOpen(true);
      }
    } catch (error) {
      console.error("Failed to read file:", error);
    }
  };

  const handleDeleteFile = (filename: string) => {
    setFileToDelete(filename);
    setIsDeleteModalOpen(true);
  };

  return (
    <>
      <div className="flex-1 flex overflow-hidden h-full">
        <VideoContextPanel
          videoSrc={`/api/videos/${videoId}/stream`}
          transcriptWordCount={transcriptWordCount}
          clipSections={clipSections}
          enabledSections={enabledSections}
          onEnabledSectionsChange={setEnabledSections}
          includeTranscript={includeTranscript}
          onIncludeTranscriptChange={setIncludeTranscript}
          courseStructure={courseStructure}
          includeCourseStructure={includeCourseStructure}
          onIncludeCourseStructureChange={setIncludeCourseStructure}
          files={files}
          isStandalone={isStandalone}
          enabledFiles={enabledFiles}
          onEnabledFilesChange={setEnabledFiles}
          onFileClick={handleFileClick}
          onAddFromClipboardClick={
            isStandalone
              ? () => setIsPasteModalOpen(true)
              : () => setIsLessonPasteModalOpen(true)
          }
          onEditFile={handleEditFile}
          onDeleteFile={handleDeleteFile}
          links={links}
          onAddLinkClick={() => setIsAddLinkModalOpen(true)}
          onDeleteLink={(linkId) => {
            deleteLinkFetcher.submit(null, {
              method: "post",
              action: `/api/links/${linkId}/delete`,
            });
          }}
          videoSlot={<Video src={`/api/videos/${videoId}/stream`} />}
        />

        {/* Right panel: Title and Description (or Connect prompt) */}
        <div className="w-3/4 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-gray-700 hover:scrollbar-thumb-gray-600">
          {!isYoutubeAuthenticated ? (
            <div className="flex-1 flex items-center justify-center">
              <Card className="max-w-md w-full">
                <CardHeader className="text-center">
                  <YoutubeIcon className="h-12 w-12 mx-auto mb-2 text-red-500" />
                  <CardTitle>Connect YouTube Account</CardTitle>
                  <CardDescription>
                    Connect your YouTube account to upload videos directly from
                    this app.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                  <Button asChild>
                    <a
                      href={`/api/auth/google/initiate?returnTo=/videos/${videoId}/post`}
                    >
                      Connect YouTube Account
                    </a>
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto w-full space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="title">Title</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateTitle}
                    disabled={isGeneratingTitle || isGeneratingDescription}
                  >
                    {isGeneratingTitle ? (
                      <>
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <SparklesIcon className="h-4 w-4" />
                        Generate
                      </>
                    )}
                  </Button>
                </div>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter video title..."
                  className="text-lg"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="description">Description</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateDescription}
                    disabled={isGeneratingTitle || isGeneratingDescription}
                  >
                    {isGeneratingDescription ? (
                      <>
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <SparklesIcon className="h-4 w-4" />
                        Generate
                      </>
                    )}
                  </Button>
                </div>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter video description..."
                  className="min-h-[300px] resize-y"
                />
              </div>

              {/* Visibility */}
              <div className="flex items-center gap-2">
                <Label htmlFor="visibility">Visibility</Label>
                <Select
                  value={privacyStatus}
                  onValueChange={(value: "public" | "unlisted") =>
                    setPrivacyStatus(value)
                  }
                >
                  <SelectTrigger id="visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unlisted">Unlisted</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Thumbnail selection */}
              <div className="space-y-2">
                <Label>Thumbnail</Label>
                {thumbnails.length === 0 ? (
                  <div className="border border-dashed rounded-lg p-6 text-center text-muted-foreground">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No thumbnails created yet.</p>
                    <Link
                      to={`/videos/${videoId}/thumbnails`}
                      className="text-sm text-primary hover:underline mt-1 inline-block"
                    >
                      Create a thumbnail
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {thumbnails.map((thumbnail) => (
                      <button
                        key={thumbnail.id}
                        onClick={() => handleSelectThumbnail(thumbnail.id)}
                        disabled={selectingThumbnailId !== null}
                        className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                          thumbnail.selectedForUpload
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-transparent hover:border-muted-foreground/30"
                        }`}
                      >
                        <img
                          src={`/api/thumbnails/${thumbnail.id}/image`}
                          alt="Thumbnail"
                          className="w-full h-full object-cover"
                        />
                        {thumbnail.selectedForUpload && (
                          <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5">
                            <CheckIcon className="h-3 w-3" />
                          </div>
                        )}
                        {selectingThumbnailId === thumbnail.id && (
                          <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                            <Loader2Icon className="h-5 w-5 animate-spin" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Upload section */}
              <div className="space-y-3">
                <Button
                  onClick={handleUpload}
                  disabled={
                    uploadStatus === "uploading" ||
                    !title.trim() ||
                    !description.trim()
                  }
                  className="w-full"
                  size="lg"
                >
                  {uploadStatus === "uploading" ? (
                    <>
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <UploadIcon className="h-4 w-4" />
                      Post to YouTube
                    </>
                  )}
                </Button>

                {/* Progress bar */}
                {uploadStatus === "uploading" && (
                  <div className="space-y-1">
                    <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-primary h-full rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground text-center">
                      {uploadProgress}%
                    </p>
                  </div>
                )}

                {/* Success state */}
                {uploadStatus === "success" && (
                  <div className="flex flex-col items-center gap-2 text-green-500">
                    <div className="flex items-center gap-2">
                      <CheckCircle2Icon className="h-4 w-4" />
                      <span className="text-sm">
                        Video uploaded successfully as {privacyStatus}
                      </span>
                    </div>
                    {youtubeVideoId && (
                      <a
                        href={`https://studio.youtube.com/video/${youtubeVideoId}/edit`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-500 hover:underline"
                      >
                        Open in YouTube Studio
                      </a>
                    )}
                  </div>
                )}

                {/* Error state */}
                {uploadStatus === "error" && (
                  <div className="flex items-center gap-2 text-destructive justify-center">
                    <XCircleIcon className="h-4 w-4" />
                    <span className="text-sm">{uploadError}</span>
                  </div>
                )}
              </div>

              {/* Disconnect YouTube account */}
              <div className="pt-4 border-t border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={handleDisconnect}
                >
                  <UnplugIcon className="h-4 w-4" />
                  Disconnect YouTube Account
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* File preview modal */}
      <FilePreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        videoId={videoId}
        filePath={previewFilePath}
        isStandalone={isStandalone}
      />

      {/* Add link modal */}
      <AddLinkModal
        open={isAddLinkModalOpen}
        onOpenChange={setIsAddLinkModalOpen}
      />

      {/* Standalone file modals */}
      {isStandalone && (
        <>
          <StandaloneFileManagementModal
            videoId={videoId}
            filename={selectedFilename}
            content={selectedFileContent}
            open={isFileModalOpen}
            onOpenChange={setIsFileModalOpen}
          />
          <StandaloneFilePasteModal
            videoId={videoId}
            open={isPasteModalOpen}
            onOpenChange={setIsPasteModalOpen}
            existingFiles={files}
            onFileCreated={(filename) => {
              setEnabledFiles((prev) => new Set([...prev, filename]));
            }}
          />
          <DeleteStandaloneFileModal
            videoId={videoId}
            filename={fileToDelete}
            open={isDeleteModalOpen}
            onOpenChange={setIsDeleteModalOpen}
          />
        </>
      )}

      {/* Lesson file paste modal */}
      {!isStandalone && (
        <LessonFilePasteModal
          videoId={videoId}
          open={isLessonPasteModalOpen}
          onOpenChange={setIsLessonPasteModalOpen}
          existingFiles={files}
          onFileCreated={(filename) => {
            setEnabledFiles((prev) => new Set([...prev, filename]));
          }}
        />
      )}

      {/* Overwrite confirmation dialog */}
      <Dialog
        open={confirmOverwriteField !== null}
        onOpenChange={(open) => {
          if (!open) handleCancelOverwrite();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace existing content?</DialogTitle>
            <DialogDescription>
              The {confirmOverwriteField} field already has content. Do you want
              to replace it with the generated text?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelOverwrite}>
              Cancel
            </Button>
            <Button onClick={handleConfirmOverwrite}>Replace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
