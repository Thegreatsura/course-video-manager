"use client";

import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CheckIcon, ImageIcon, Loader2Icon, PlusIcon } from "lucide-react";

export function ThumbnailSelector({
  videoId,
  thumbnails,
}: {
  videoId: string;
  thumbnails: Array<{ id: string; selectedForUpload: boolean }>;
}) {
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

  return (
    <div className="space-y-2">
      <Label>Thumbnail</Label>
      {thumbnails.length === 0 ? (
        <div className="border border-dashed rounded-lg p-6 text-center text-muted-foreground">
          <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No thumbnails created yet.</p>
          <Button variant="outline" size="sm" className="mt-2" asChild>
            <Link to={`/videos/${videoId}/thumbnails`}>
              <PlusIcon className="h-4 w-4" />
              Add New Thumbnail
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
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
          <Button variant="outline" size="sm" asChild>
            <Link to={`/videos/${videoId}/thumbnails`}>
              <PlusIcon className="h-4 w-4" />
              Add New Thumbnail
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
