import { statSync } from "fs";
import { webFileStream } from "@/services/web-file-stream.server";
import { findStoragePathSync } from "@/packages/storage/server";
import { readStorageRootsSync } from "@/services/storage-roots";
import type { Route } from "./+types/view-video";

export const loader = async (args: Route.LoaderArgs) => {
  const request = args.request;
  const searchParams = new URL(request.url).searchParams;
  const storedPath = searchParams.get("videoPath");

  if (!storedPath) {
    return new Response("Missing videoPath on search params", {
      status: 400,
    });
  }

  // The editor names the path the row stores (root-relative, or legacy
  // absolute); the file is on the first Storage Root that has it.
  const videoPath = findStoragePathSync(storedPath, readStorageRootsSync());
  if (videoPath === null) {
    return new Response(null, { status: 404 });
  }

  try {
    const stat = statSync(videoPath);
    const fileSize = stat.size;

    const range = request.headers.get("range");

    if (range) {
      // Handle range requests for video seeking
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0]!, 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      return new Response(webFileStream(videoPath, { start, end }), {
        status: 206, // Partial Content
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize.toString(),
          "Content-Type": "video/mp4",
        },
      });
    } else {
      // Handle regular requests
      return new Response(webFileStream(videoPath), {
        headers: {
          "Content-Length": fileSize.toString(),
          "Accept-Ranges": "bytes",
          "Content-Type": "video/mp4",
        },
      });
    }
  } catch (error) {
    return new Response(null, {
      status: 404,
    });
  }
};
