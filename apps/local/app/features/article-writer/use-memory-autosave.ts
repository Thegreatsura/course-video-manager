"use client";

import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { createMemoryAutosaver } from "./memory-autosaver";

export function useMemoryAutosave(memoryText: string, repoId: string | null) {
  const fetcher = useFetcher();
  const submitRef = useRef(fetcher.submit);
  submitRef.current = fetcher.submit;
  const saverRef = useRef<{
    repoId: string | null;
    saver: ReturnType<typeof createMemoryAutosaver>;
  } | null>(null);

  // Seed the baseline from the first value seen for this course, so opening
  // the writer never writes it back unchanged.
  if (!saverRef.current || saverRef.current.repoId !== repoId) {
    saverRef.current = {
      repoId,
      saver: createMemoryAutosaver({
        initial: memoryText,
        save: (memory) => {
          if (!repoId) return;
          submitRef.current(
            { memory },
            { method: "post", action: `/api/courses/${repoId}/update-memory` }
          );
        },
      }),
    };
  }

  useEffect(() => {
    const { saver } = saverRef.current!;
    saver.update(memoryText);
    return () => saver.cancel();
  }, [memoryText, repoId]);
}
