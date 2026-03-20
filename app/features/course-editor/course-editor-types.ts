import type { Brand } from "@/features/video-editor/utils";

// ============================================================================
// Branded ID Types
// ============================================================================

export type FrontendId = Brand<string, "FrontendId">;
export type DatabaseId = Brand<string, "DatabaseId">;

// ============================================================================
// Entity Types
// ============================================================================

export type EditorVideo = {
  id: string;
  filename: string | null;
  path: string;
  duration: number | null;
  hasTranscript: boolean;
  clipCount: number;
};

export type EditorLesson = {
  frontendId: FrontendId;
  databaseId: DatabaseId | null;
  sectionId: string;
  path: string;
  title: string;
  fsStatus: string;
  description: string;
  icon: string | null;
  priority: number;
  dependencies: string[] | null;
  order: number;
  videos: EditorVideo[];
};

export type EditorSection = {
  frontendId: FrontendId;
  databaseId: DatabaseId | null;
  repoVersionId: string;
  path: string;
  order: number;
  lessons: EditorLesson[];
};
