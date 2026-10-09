import { useContext, useEffect, useMemo, useRef } from "react";
import { useRevalidator } from "react-router";
import { UploadContext } from "@/features/upload-manager/upload-context";
import type {
  UploadStatus,
  UploadType,
} from "@/features/upload-manager/upload-entry";
import { jobUploadEntries } from "@/features/jobs/jobs-selectors";

type UploadSnapshot = Record<
  string,
  { status: UploadStatus; uploadType: UploadType }
>;

export function hasNewSuccessForTypes(
  prev: UploadSnapshot,
  current: UploadSnapshot,
  types: Set<UploadType>
): boolean {
  for (const [id, upload] of Object.entries(current)) {
    const prevUpload = prev[id];
    if (!prevUpload) continue;
    if (prevUpload.status === upload.status) continue;
    if (upload.status === "success" && types.has(upload.uploadType)) {
      return true;
    }
  }
  return false;
}

export function useUploadRevalidate(uploadTypes: UploadType[]) {
  const { jobs } = useContext(UploadContext);
  // Every row a background Job draws (an export, a render, each Video of a
  // Batch export).
  const uploads = useMemo(() => {
    const all: UploadSnapshot = {};
    for (const job of Object.values(jobs.jobs)) {
      for (const entry of jobUploadEntries(job)) all[entry.uploadId] = entry;
    }
    return all;
  }, [jobs.jobs]);
  const revalidator = useRevalidator();
  const previousRef = useRef(uploads);
  const typesRef = useRef(new Set<UploadType>(uploadTypes));

  useEffect(() => {
    if (hasNewSuccessForTypes(previousRef.current, uploads, typesRef.current)) {
      revalidator.revalidate();
    }
    previousRef.current = uploads;
  }, [uploads, revalidator]);
}
