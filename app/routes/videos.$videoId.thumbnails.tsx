import { DBFunctionsService } from "@/services/db-service";
import { runtimeLive } from "@/services/layer";
import { Console, Effect } from "effect";
import { data, useRevalidator } from "react-router";
import type { Route } from "./+types/videos.$videoId.thumbnails";
import {
  CameraIcon,
  ImageIcon,
  SaveIcon,
  Loader2Icon,
  ClipboardIcon,
  XIcon,
  Trash2Icon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import type { ThumbnailLayers } from "@/services/thumbnail-schema";
import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CaptureCameraModal } from "@/components/capture-camera-modal";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

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

/**
 * Draws an image onto a canvas using crop-to-cover (fills entire canvas, cropping excess).
 */
function drawCropToCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasWidth: number,
  canvasHeight: number
) {
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let sx: number, sy: number, sw: number, sh: number;

  if (imgAspect > canvasAspect) {
    // Image is wider — crop sides
    sh = img.naturalHeight;
    sw = sh * canvasAspect;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    // Image is taller — crop top/bottom
    sw = img.naturalWidth;
    sh = sw / canvasAspect;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight);
}

export default function ThumbnailsPage({ loaderData }: Route.ComponentProps) {
  const { videoId, thumbnails } = loaderData;
  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [diagramImage, setDiagramImage] = useState<string | null>(null);
  const [diagramPosition, setDiagramPosition] = useState(50);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingThumbnailId, setEditingThumbnailId] = useState<string | null>(
    null
  );
  const [loadingEdit, setLoadingEdit] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const revalidator = useRevalidator();

  const handleCapture = (dataUrl: string) => {
    setCapturedPhoto(dataUrl);
  };

  // Draw all layers onto the canvas compositor
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !capturedPhoto) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Layer 1: Background photo (crop-to-cover)
    const bgImg = new Image();
    bgImg.onload = () => {
      drawCropToCover(ctx, bgImg, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Layer 2: Diagram (scaled to full height, positioned horizontally)
      if (diagramImage) {
        const diagImg = new Image();
        diagImg.onload = () => {
          const scale = CANVAS_HEIGHT / diagImg.naturalHeight;
          const scaledWidth = diagImg.naturalWidth * scale;
          // diagramPosition: 0 = left edge, 50 = center, 100 = right edge
          const maxOffset = CANVAS_WIDTH - scaledWidth;
          const x = maxOffset * (diagramPosition / 100);
          ctx.drawImage(diagImg, x, 0, scaledWidth, CANVAS_HEIGHT);
        };
        diagImg.src = diagramImage;
      }
    };
    bgImg.src = capturedPhoto;
  }, [capturedPhoto, diagramImage, diagramPosition]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Handle clipboard paste for diagram images
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (!capturedPhoto) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || !item.type.startsWith("image/")) continue;

        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = () => {
            setDiagramImage(reader.result as string);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    },
    [capturedPhoto]
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleDelete = async (thumbnailId: string) => {
    if (!confirm("Delete this thumbnail?")) return;
    setDeleting(thumbnailId);
    try {
      const response = await fetch(`/api/thumbnails/${thumbnailId}/delete`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to delete thumbnail");
      }
      revalidator.revalidate();
    } catch (error) {
      console.error("Failed to delete thumbnail:", error);
    } finally {
      setDeleting(null);
    }
  };

  const handleEdit = async (thumbnailId: string) => {
    const thumbnail = thumbnails.find((t) => t.id === thumbnailId);
    if (!thumbnail) return;

    setLoadingEdit(thumbnailId);
    try {
      const layers = thumbnail.layers as unknown as ThumbnailLayers;

      // Fetch background photo as data URL
      const bgResponse = await fetch(`/api/thumbnails/${thumbnailId}/layer/bg`);
      if (!bgResponse.ok) throw new Error("Failed to load background image");
      const bgBlob = await bgResponse.blob();
      const bgDataUrl = await blobToDataUrl(bgBlob);

      // Fetch diagram if it exists
      let diagDataUrl: string | null = null;
      let diagPos = 50;
      if (layers.diagram) {
        const diagResponse = await fetch(
          `/api/thumbnails/${thumbnailId}/layer/diagram`
        );
        if (diagResponse.ok) {
          const diagBlob = await diagResponse.blob();
          diagDataUrl = await blobToDataUrl(diagBlob);
          diagPos = layers.diagram.horizontalPosition;
        }
      }

      // Load into editor state
      setCapturedPhoto(bgDataUrl);
      setDiagramImage(diagDataUrl);
      setDiagramPosition(diagPos);
      setEditingThumbnailId(thumbnailId);
    } catch (error) {
      console.error("Failed to load thumbnail for editing:", error);
    } finally {
      setLoadingEdit(null);
    }
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !capturedPhoto) return;

    setSaving(true);
    try {
      // Export canvas to data URL
      const exportDataUrl = canvas.toDataURL("image/png");

      const payload = {
        videoId,
        imageDataUrl: exportDataUrl,
        diagramDataUrl: diagramImage,
        diagramPosition: diagramImage ? diagramPosition : undefined,
      };

      let response: Response;
      if (editingThumbnailId) {
        // Update existing thumbnail
        response = await fetch(`/api/thumbnails/${editingThumbnailId}/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        // Create new thumbnail
        response = await fetch("/api/thumbnails/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!response.ok) {
        throw new Error("Failed to save thumbnail");
      }

      // Clear state and revalidate to show updated/new thumbnail
      setCapturedPhoto(null);
      setDiagramImage(null);
      setDiagramPosition(50);
      setEditingThumbnailId(null);
      revalidator.revalidate();
    } catch (error) {
      console.error("Failed to save thumbnail:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleNewThumbnail = () => {
    setCapturedPhoto(null);
    setDiagramImage(null);
    setDiagramPosition(50);
    setEditingThumbnailId(null);
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
            {editingThumbnailId ? "Editing Thumbnail" : "Canvas Preview"}
          </h3>
          <div className="inline-block overflow-hidden rounded-lg border">
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className="h-auto max-w-2xl w-full"
            />
          </div>
          {/* Layer controls */}
          <div className="mt-4 space-y-3">
            <h3 className="text-sm font-medium text-gray-400">Layers</h3>

            {/* Background layer */}
            <div className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
              <ImageIcon className="size-4 text-gray-400" />
              <span>Background Photo</span>
            </div>

            {/* Diagram layer */}
            {diagramImage ? (
              <div className="rounded border px-3 py-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <ClipboardIcon className="size-4 text-gray-400" />
                    <span>Diagram</span>
                  </div>
                  <button
                    onClick={() => setDiagramImage(null)}
                    className="text-gray-400 hover:text-gray-200"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
                <div className="mt-2">
                  <Label className="text-xs text-gray-400">
                    Horizontal Position
                  </Label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={diagramPosition}
                    onChange={(e) => setDiagramPosition(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded border border-dashed px-3 py-2 text-sm text-gray-500">
                <ClipboardIcon className="size-4" />
                <span>Paste a diagram from clipboard (Ctrl+V)</span>
              </div>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
              {saving
                ? "Saving..."
                : editingThumbnailId
                  ? "Update Thumbnail"
                  : "Save Thumbnail"}
            </Button>
            {editingThumbnailId && (
              <Button variant="outline" onClick={handleNewThumbnail}>
                <PlusIcon />
                New Thumbnail
              </Button>
            )}
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
        thumbnails.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-medium text-gray-400">
              Saved Thumbnails
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {thumbnails.map((thumbnail) => (
                <div
                  key={thumbnail.id}
                  className={`group relative rounded-lg overflow-hidden cursor-pointer transition-all ${
                    editingThumbnailId === thumbnail.id
                      ? "ring-2 ring-blue-500 border border-blue-500"
                      : "border hover:border-gray-400"
                  }`}
                  onClick={() => handleEdit(thumbnail.id)}
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
                  {loadingEdit === thumbnail.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2Icon className="size-6 animate-spin text-white" />
                    </div>
                  )}
                  <div className="absolute top-2 left-2 rounded-md bg-black/60 p-1.5 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100">
                    <PencilIcon className="size-4" />
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(thumbnail.id);
                    }}
                    disabled={deleting === thumbnail.id}
                    className="absolute top-2 right-2 rounded-md bg-black/60 p-1.5 text-gray-300 opacity-0 transition-opacity hover:bg-red-600 hover:text-white group-hover:opacity-100 disabled:opacity-50"
                  >
                    {deleting === thumbnail.id ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      <CaptureCameraModal
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCapture={handleCapture}
      />
    </div>
  );
}
