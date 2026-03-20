import type { GitStatus } from "@/services/git-status-service";
import { useCallback, useEffect, useRef, useState } from "react";

export type FsGitStatusData = {
  hasExportedVideoMap: Record<string, boolean>;
  lessonFsMaps: {
    hasExplainerFolderMap: Record<string, boolean>;
    lessonHasFilesMap: Record<string, { path: string; size: number }[]>;
  };
  gitStatus: GitStatus | null;
};

const EMPTY_DATA: FsGitStatusData = {
  hasExportedVideoMap: {},
  lessonFsMaps: {
    hasExplainerFolderMap: {},
    lessonHasFilesMap: {},
  },
  gitStatus: null,
};

interface UseFsGitStatusOptions {
  courseId: string | null;
  versionId?: string | null;
  /** Polling interval in ms. Defaults to 5000. */
  intervalMs?: number;
  /** Initial data from the loader to avoid a flash before the first poll. */
  initialData?: FsGitStatusData;
}

/**
 * Polls for filesystem and git status independently of the course editor reducer.
 * Returns read-only data for direct component consumption.
 */
export function useFsGitStatus(
  options: UseFsGitStatusOptions
): FsGitStatusData {
  const { courseId, versionId, intervalMs = 5000, initialData } = options;
  const [data, setData] = useState<FsGitStatusData>(initialData ?? EMPTY_DATA);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!courseId) {
      setData(EMPTY_DATA);
      return;
    }

    // Cancel any in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const params = new URLSearchParams({ courseId });
    if (versionId) {
      params.set("versionId", versionId);
    }

    try {
      const response = await fetch(`/api/fs-git-status?${params}`, {
        signal: controller.signal,
      });
      if (response.ok) {
        const json = await response.json();
        setData(json);
      }
    } catch {
      // Aborted or network error — ignore silently
    }
  }, [courseId, versionId]);

  useEffect(() => {
    if (!courseId) {
      setData(EMPTY_DATA);
      return;
    }

    // Fetch immediately on mount / courseId change
    fetchStatus();

    const interval = setInterval(fetchStatus, intervalMs);

    return () => {
      clearInterval(interval);
      abortControllerRef.current?.abort();
    };
  }, [courseId, versionId, intervalMs, fetchStatus]);

  return data;
}
