import { DBFunctionsService } from "@/services/db-service";
import { runtimeLive } from "@/services/layer";
import { Console, Effect } from "effect";
import { data } from "react-router";
import type { Route } from "./+types/videos.$videoId.thumbnails";
import { CameraIcon, ImageIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CaptureCameraModal } from "@/components/capture-camera-modal";

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const thumbnails = yield* db.getThumbnailsByVideoId(videoId);

    return { videoId, thumbnails };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

export default function ThumbnailsPage({ loaderData }: Route.ComponentProps) {
  const { thumbnails } = loaderData;
  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);

  const handleCapture = (dataUrl: string) => {
    setCapturedPhoto(dataUrl);
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          Thumbnails {thumbnails.length > 0 && `(${thumbnails.length})`}
        </h2>
        <Button onClick={() => setCameraOpen(true)}>
          <CameraIcon />
          Capture Face
        </Button>
      </div>

      {capturedPhoto && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-medium text-gray-400">
            Captured Photo
          </h3>
          <div className="inline-block overflow-hidden rounded-lg border">
            <img
              src={capturedPhoto}
              alt="Captured face"
              className="h-auto max-w-md"
            />
          </div>
        </div>
      )}

      {thumbnails.length === 0 && !capturedPhoto ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-4">
          <ImageIcon className="size-16 opacity-50" />
          <div className="text-center">
            <p className="text-lg font-medium">No thumbnails yet</p>
            <p className="text-sm mt-1">
              Capture a face photo to start creating thumbnails.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {thumbnails.map((thumbnail) => (
            <div
              key={thumbnail.id}
              className="border rounded-lg overflow-hidden"
            >
              {thumbnail.filePath ? (
                <img
                  src={`/api/thumbnails/${thumbnail.id}/image`}
                  alt="Thumbnail"
                  className="w-full aspect-video object-cover"
                />
              ) : (
                <div className="w-full aspect-video bg-gray-800 flex items-center justify-center text-gray-500">
                  Not rendered
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <CaptureCameraModal
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCapture={handleCapture}
      />
    </div>
  );
}
