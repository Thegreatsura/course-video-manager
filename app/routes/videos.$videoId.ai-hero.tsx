"use client";

import { DBFunctionsService } from "@/services/db-service.server";
import { sortByOrder } from "@/lib/sort-by-order";
import { runtimeLive } from "@/services/layer.server";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import { Array as EffectArray, Console, Effect } from "effect";
import { useContext, useEffect, useRef, useState } from "react";
import { data, useFetcher, useRevalidator } from "react-router";
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
  CopyIcon,
  ExternalLinkIcon,
  ImageIcon,
  Loader2Icon,
  SendIcon,
  SparklesIcon,
  UnplugIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { UploadContext } from "@/features/upload-manager/upload-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Route } from "./+types/videos.$videoId.ai-hero";
import path from "path";
import { FileSystem } from "@effect/platform";

const AI_HERO_TITLE_STORAGE_KEY = (videoId: string) =>
  `ai-hero-title-${videoId}`;
const AI_HERO_BODY_STORAGE_KEY = (videoId: string) => `ai-hero-body-${videoId}`;
const AI_HERO_SEO_DESCRIPTION_STORAGE_KEY = (videoId: string) =>
  `ai-hero-seo-description-${videoId}`;
const AI_HERO_SLUG_STORAGE_KEY = (videoId: string) => `ai-hero-slug-${videoId}`;
const AI_HERO_FORM_SLUG_STORAGE_KEY = (videoId: string) =>
  `ai-hero-form-slug-${videoId}`;

const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const fs = yield* FileSystem.FileSystem;
    const video = yield* db.getVideoWithClipsById(videoId);

    // Check AI Hero auth status
    const aiHeroAuth = yield* db.getAiHeroAuth();
    const aiHero: { connected: true; userId: string } | { connected: false } =
      aiHeroAuth
        ? { connected: true, userId: aiHeroAuth.userId }
        : { connected: false };
    const globalLinks = yield* db.getLinks();

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
        aiHero,
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
      aiHero,
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

export default function AiHeroPostPage(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    isStandalone,
    transcriptWordCount,
    clipSections,
    links,
    courseStructure,
    aiHero,
  } = props.loaderData;

  // Title with localStorage persistence
  const [title, setTitle] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(AI_HERO_TITLE_STORAGE_KEY(videoId)) ?? "";
    }
    return "";
  });

  // Body with localStorage persistence
  const [body, setBody] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(AI_HERO_BODY_STORAGE_KEY(videoId)) ?? "";
    }
    return "";
  });

  // SEO description with localStorage persistence
  const [seoDescription, setSeoDescription] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return (
        localStorage.getItem(AI_HERO_SEO_DESCRIPTION_STORAGE_KEY(videoId)) ?? ""
      );
    }
    return "";
  });

  // Editable slug with localStorage persistence
  const slugInputTouched = useRef(false);
  const [slug, setSlug] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(
        AI_HERO_FORM_SLUG_STORAGE_KEY(videoId)
      );
      if (stored) {
        slugInputTouched.current = true;
        return stored;
      }
    }
    return slugify(title);
  });

  // Auto-derive slug from title when user hasn't manually edited it
  useEffect(() => {
    if (!slugInputTouched.current) {
      setSlug(slugify(title));
    }
  }, [title]);

  // Auto-save to localStorage
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AI_HERO_TITLE_STORAGE_KEY(videoId), title);
    }
  }, [title, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AI_HERO_BODY_STORAGE_KEY(videoId), body);
    }
  }, [body, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        AI_HERO_SEO_DESCRIPTION_STORAGE_KEY(videoId),
        seoDescription
      );
    }
  }, [seoDescription, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AI_HERO_FORM_SLUG_STORAGE_KEY(videoId), slug);
    }
  }, [slug, videoId]);

  // Upload context
  const { uploads, startAiHeroUpload, startExportUpload } =
    useContext(UploadContext);

  // Check if there's an active AI Hero upload for this video
  const activeAiHeroUpload = Object.values(uploads).find(
    (u) =>
      u.uploadType === "ai-hero" &&
      u.videoId === videoId &&
      (u.status === "uploading" ||
        u.status === "retrying" ||
        u.status === "waiting")
  );

  // Stored slug from successful upload
  const [storedSlug, setStoredSlug] = useState<string | null>(null);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      setStoredSlug(
        localStorage.getItem(AI_HERO_SLUG_STORAGE_KEY(videoId)) ?? null
      );
    }
  }, [videoId]);

  // Watch for successful AI Hero uploads and store the slug
  useEffect(() => {
    for (const upload of Object.values(uploads)) {
      if (
        upload.uploadType === "ai-hero" &&
        upload.videoId === videoId &&
        upload.status === "success" &&
        upload.aiHeroSlug
      ) {
        localStorage.setItem(
          AI_HERO_SLUG_STORAGE_KEY(videoId),
          upload.aiHeroSlug
        );
        setStoredSlug(upload.aiHeroSlug);
      }
    }
  }, [uploads, videoId]);

  const isSeoDescriptionTooLong = seoDescription.length > 160;

  const [isCheckingExport, setIsCheckingExport] = useState(false);

  const handlePostToAiHero = async () => {
    if (!title.trim() || isSeoDescriptionTooLong) return;

    setIsCheckingExport(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/export-file-exists`);
      const { exists } = await res.json();

      if (exists) {
        startAiHeroUpload(videoId, title, body, seoDescription, slug);
        toast("Post started", {
          description: `"${title}" is posting to AI Hero`,
        });
      } else {
        const exportId = startExportUpload(videoId, title);
        startAiHeroUpload(videoId, title, body, seoDescription, slug, exportId);
        toast("Export + post started", {
          description: `"${title}" will export first, then post to AI Hero`,
        });
      }
    } catch {
      toast.error("Failed to check export status");
    } finally {
      setIsCheckingExport(false);
    }
  };

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
  const openFolderFetcher = useFetcher();

  useEffect(() => {
    const result = openFolderFetcher.data as { error?: string } | undefined;
    if (openFolderFetcher.state === "idle" && result?.error) {
      toast.error(result.error);
    }
  }, [openFolderFetcher.state, openFolderFetcher.data]);

  // Standalone file management state
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string>("");
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string>("");

  // Lesson file paste modal state
  const [isLessonPasteModalOpen, setIsLessonPasteModalOpen] = useState(false);

  // Cloudinary image upload state
  const [isUploadingImages, setIsUploadingImages] = useState(false);

  const handleUploadImages = async () => {
    if (!body.trim()) return;
    setIsUploadingImages(true);
    try {
      const response = await fetch(`/api/videos/${videoId}/upload-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to upload images");
      }
      const result = await response.json();
      if (result.body !== body) {
        setBody(result.body);
        toast.success("Images uploaded to Cloudinary");
      } else {
        toast("No local images found to upload");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload images"
      );
    } finally {
      setIsUploadingImages(false);
    }
  };

  // SEO description generation state
  const [isGeneratingSeo, setIsGeneratingSeo] = useState(false);
  const hasAutoGenerated = useRef(false);

  // Confirmation dialog for regenerating SEO description
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [pendingGeneratedSeo, setPendingGeneratedSeo] = useState("");

  const generateSeoDescription = async () => {
    setIsGeneratingSeo(true);
    try {
      const transcriptEnabled =
        clipSections.length > 0 ? enabledSections.size > 0 : includeTranscript;

      const response = await fetch(`/api/videos/${videoId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "seo-description",
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
        throw new Error("Failed to generate SEO description");
      }

      const result = await response.json();
      return result.text as string;
    } finally {
      setIsGeneratingSeo(false);
    }
  };

  // Auto-generate SEO description on first load if empty
  useEffect(() => {
    if (
      !hasAutoGenerated.current &&
      !seoDescription.trim() &&
      aiHero.connected
    ) {
      hasAutoGenerated.current = true;
      generateSeoDescription()
        .then((text) => {
          if (text) setSeoDescription(text);
        })
        .catch(console.error);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegenerate = async () => {
    const text = await generateSeoDescription();
    if (!text) return;

    if (seoDescription.trim()) {
      setPendingGeneratedSeo(text);
      setConfirmRegenerate(true);
    } else {
      setSeoDescription(text);
    }
  };

  const handleConfirmRegenerate = () => {
    setSeoDescription(pendingGeneratedSeo);
    setConfirmRegenerate(false);
    setPendingGeneratedSeo("");
  };

  const handleCancelRegenerate = () => {
    setConfirmRegenerate(false);
    setPendingGeneratedSeo("");
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
          onOpenFolderClick={() => {
            openFolderFetcher.submit(null, {
              method: "post",
              action: `/api/videos/${videoId}/open-folder`,
            });
          }}
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

        {/* Right panel: AI Hero post form */}
        <div className="w-3/4 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-gray-700 hover:scrollbar-thumb-gray-600">
          {!aiHero.connected ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <AiHeroConnectCard />
            </div>
          ) : (
            <div className="max-w-2xl mx-auto w-full space-y-6">
              {/* Connection status */}
              <AiHeroConnectionStatus userId={aiHero.userId} />

              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="ai-hero-title">Title</Label>
                <Input
                  id="ai-hero-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter post title..."
                  className="text-lg"
                />
              </div>

              {/* Slug */}
              <div className="space-y-2">
                <Label htmlFor="ai-hero-slug">Slug</Label>
                <Input
                  id="ai-hero-slug"
                  value={slug}
                  onChange={(e) => {
                    slugInputTouched.current = true;
                    setSlug(e.target.value);
                  }}
                  placeholder="post-slug"
                  className="font-mono text-sm"
                />
              </div>

              {/* Body */}
              <div className="space-y-2">
                <Label htmlFor="ai-hero-body">Body (Markdown)</Label>
                <Textarea
                  id="ai-hero-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your post body in markdown..."
                  className="min-h-[300px] resize-y font-mono"
                />
              </div>

              {/* Upload Images to Cloudinary */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleUploadImages}
                disabled={isUploadingImages || !body.trim()}
              >
                {isUploadingImages ? (
                  <>
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    Uploading images...
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-4 w-4" />
                    Upload Images to Cloudinary
                  </>
                )}
              </Button>

              {/* SEO Description */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ai-hero-seo">SEO Description</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerate}
                    disabled={isGeneratingSeo}
                  >
                    {isGeneratingSeo ? (
                      <>
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <SparklesIcon className="h-4 w-4" />
                        Regenerate
                      </>
                    )}
                  </Button>
                </div>
                <Textarea
                  id="ai-hero-seo"
                  value={seoDescription}
                  onChange={(e) => setSeoDescription(e.target.value)}
                  placeholder={
                    isGeneratingSeo
                      ? "Generating SEO description..."
                      : "SEO description (160 characters max)..."
                  }
                  className={`min-h-[80px] resize-y ${isSeoDescriptionTooLong ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                />
                <p
                  className={`text-xs text-right ${isSeoDescriptionTooLong ? "text-red-500" : "text-muted-foreground"}`}
                >
                  {seoDescription.length}/160
                </p>
              </div>

              {/* Post to AI Hero button */}
              {storedSlug ? (
                <div className="flex items-center gap-3 p-3 rounded-md bg-green-500/10 border border-green-500/20">
                  <CheckCircle2Icon className="h-5 w-5 text-green-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-500">
                      Posted to AI Hero
                    </p>
                    <a
                      href={`https://aihero.dev/${storedSlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 truncate"
                    >
                      View on AI Hero
                      <ExternalLinkIcon className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePostToAiHero}
                    disabled={
                      !title.trim() ||
                      !!activeAiHeroUpload ||
                      isCheckingExport ||
                      isSeoDescriptionTooLong
                    }
                  >
                    {isCheckingExport ? (
                      <>
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                        Checking export...
                      </>
                    ) : (
                      "Repost"
                    )}
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={handlePostToAiHero}
                  disabled={
                    !title.trim() ||
                    !!activeAiHeroUpload ||
                    isCheckingExport ||
                    isSeoDescriptionTooLong
                  }
                  className="w-full"
                  size="lg"
                >
                  {isCheckingExport ? (
                    <>
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                      Checking export...
                    </>
                  ) : activeAiHeroUpload ? (
                    <>
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                      Posting to AI Hero...
                    </>
                  ) : (
                    <>
                      <SendIcon className="h-4 w-4" />
                      Post to AI Hero
                    </>
                  )}
                </Button>
              )}
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

      {/* Regenerate confirmation dialog */}
      <Dialog
        open={confirmRegenerate}
        onOpenChange={(open) => {
          if (!open) handleCancelRegenerate();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace SEO description?</DialogTitle>
            <DialogDescription>
              The SEO description field already has content. Do you want to
              replace it with the newly generated text?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelRegenerate}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRegenerate}>Replace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AiHeroConnectCard() {
  const [deviceFlow, setDeviceFlow] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
  } | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const revalidator = useRevalidator();

  const startDeviceFlow = async () => {
    setError(null);
    try {
      const res = await fetch("/api/auth/ai-hero/device-code", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start device flow");
        return;
      }
      setDeviceFlow({
        userCode: data.userCode,
        verificationUri: data.verificationUri,
        deviceCode: data.deviceCode,
      });
      setPolling(true);
      try {
        const pollRes = await fetch("/api/auth/ai-hero/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode: data.deviceCode }),
        });
        const pollData = await pollRes.json();
        if (pollRes.ok && pollData.success) {
          setDeviceFlow(null);
          revalidator.revalidate();
        } else {
          setError(pollData.error || "Authorization failed");
        }
      } finally {
        setPolling(false);
      }
    } catch {
      setError("Failed to connect to server");
    }
  };

  const copyUserCode = () => {
    if (deviceFlow) {
      navigator.clipboard.writeText(deviceFlow.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card className="max-w-md w-full">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center gap-2">
          <XCircleIcon className="h-5 w-5 text-gray-400" />
          <CardTitle>Connect AI Hero Account</CardTitle>
        </div>
        <CardDescription>
          Connect your AI Hero account to publish posts directly from this app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {!deviceFlow ? (
          <div className="flex justify-center">
            <Button onClick={startDeviceFlow}>Connect to AI Hero</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-300">
              Enter this code on AI Hero to connect your account:
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-gray-800 px-4 py-2 rounded text-lg font-mono tracking-wider">
                {deviceFlow.userCode}
              </code>
              <Button variant="ghost" size="icon" onClick={copyUserCode}>
                {copied ? (
                  <CheckIcon className="size-4" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <a
                  href={deviceFlow.verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open AI Hero Activation Page
                </a>
              </Button>
              {polling && (
                <span className="flex items-center gap-1.5 text-sm text-gray-400">
                  <Loader2Icon className="size-4 animate-spin" />
                  Waiting for authorization...
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AiHeroConnectionStatus({ userId }: { userId: string }) {
  const disconnectFetcher = useFetcher();

  return (
    <div className="flex items-center justify-between p-3 rounded-md bg-muted/50 border">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2Icon className="h-4 w-4 text-green-500" />
        Connected as {userId}
      </div>
      <disconnectFetcher.Form
        method="post"
        action="/api/auth/ai-hero/disconnect"
      >
        <Button variant="ghost" size="sm" type="submit">
          <UnplugIcon className="size-3.5 mr-1" />
          Disconnect
        </Button>
      </disconnectFetcher.Form>
    </div>
  );
}
