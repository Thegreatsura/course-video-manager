import type { storageAction } from "./storage-action";

/** The server's refusal arrives as a JSON string, or as plain text. */
const refusalText = (body: string) => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "string") return parsed;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof parsed.message === "string"
    )
      return parsed.message;
    return body;
  } catch {
    return body;
  }
};

const enc = encodeURIComponent;

/** A JSON POST's options. */
const postOf = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const answer = async <T>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(refusalText(await response.text()));
  return (await response.json()) as T;
};

const withPaths = (query: URLSearchParams, paths: readonly string[] | null) => {
  for (const p of paths ?? []) query.append("path", p);
  return query;
};

/**
 * The one request a dry run (`dryRun: true`) or a start (`false`) makes.
 * Each `fetch` names its own `/api/…` URL: the app calling itself.
 */
const request = (
  r: storageAction.Request,
  dryRun: boolean
): Promise<Response> => {
  switch (r.type) {
    case "move": {
      const query = withPaths(
        new URLSearchParams({ kind: r.kind, target: r.target }),
        r.paths
      );
      return dryRun
        ? fetch(`/api/storage/buckets/${enc(r.bucket.id)}/move-plan?${query}`)
        : fetch(
            `/api/storage/buckets/${enc(r.bucket.id)}/move`,
            postOf({
              kind: r.kind,
              target: r.target,
              ...(r.paths === null ? {} : { paths: r.paths }),
            })
          );
    }
    case "purge":
      return fetch(
        `/api/storage/buckets/${enc(r.bucket.id)}/purge-exports`,
        postOf({
          dryRun,
          bucketName: r.bucket.name,
          ...(r.exportPaths === null ? {} : { exportPaths: r.exportPaths }),
        })
      );
    case "delete-bucket":
      return fetch(
        `/api/storage/buckets/${enc(r.bucket.id)}/delete`,
        postOf({
          dryRun,
          bucketName: r.bucket.name,
          ...(r.files === null ? {} : { files: r.files }),
        })
      );
    case "originals": {
      const query = withPaths(new URLSearchParams({ from: r.from }), r.paths);
      return dryRun
        ? fetch(
            `/api/storage/buckets/${enc(r.bucket.id)}/originals-plan?${query}`
          )
        : fetch(
            `/api/storage/buckets/${enc(r.bucket.id)}/delete-originals`,
            postOf({
              from: r.from,
              ...(r.paths === null ? {} : { paths: r.paths }),
            })
          );
    }
    case "trash-unused":
      return fetch(
        "/api/storage/trash",
        postOf({
          operation: "trash-unused",
          dryRun,
          ...(r.files === null ? {} : { files: r.files }),
        })
      );
    case "restore-trash":
      return fetch(
        "/api/storage/trash",
        postOf({ operation: "restore-trash", dryRun, files: r.files })
      );
    case "empty-trash":
      return fetch(
        "/api/storage/trash",
        postOf({ operation: "empty-trash", dryRun })
      );
  }
};

const planOf = (
  r: storageAction.Request,
  body: unknown
): storageAction.Plan => {
  switch (r.type) {
    case "move":
      return { type: "move", plan: body as never };
    case "purge":
      return { type: "purge", result: body as never };
    case "delete-bucket":
      return { type: "delete-bucket", result: body as never };
    case "originals":
      return { type: "originals", result: body as never };
    case "trash-unused":
    case "restore-trash":
    case "empty-trash":
      return { type: "trash", result: body as never };
  }
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The `plan-storage-action` effect: the server's dry run. */
export const planStorageAction = (
  effect: Extract<storageAction.Effect, { type: "plan-storage-action" }>,
  dispatch: (action: storageAction.Action) => void
) => {
  request(effect.request, true)
    .then((response) => answer<unknown>(response))
    .then((body) =>
      dispatch({
        type: "storage-action-planned",
        requestId: effect.requestId,
        plan: planOf(effect.request, body),
      })
    )
    .catch((error: unknown) =>
      dispatch({
        type: "storage-action-failed",
        requestId: effect.requestId,
        message: errorText(error),
      })
    );
};

/** The `start-storage-action` effect: queue the Job; answers its id. */
export const startStorageAction = (
  effect: Extract<storageAction.Effect, { type: "start-storage-action" }>,
  dispatch: (action: storageAction.Action) => void
) => {
  request(effect.request, false)
    .then((response) => answer<{ jobId: string }>(response))
    .then(({ jobId }) =>
      dispatch({
        type: "storage-action-started",
        requestId: effect.requestId,
        jobId,
      })
    )
    .catch((error: unknown) =>
      dispatch({
        type: "storage-action-failed",
        requestId: effect.requestId,
        message: errorText(error),
      })
    );
};
