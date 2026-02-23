import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageIcon, Loader2Icon, UploadIcon } from "lucide-react";

export default function TestRemoveBackground() {
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        setSourceImage(reader.result as string);
        setResultImage(null);
        setError(null);
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const handlePaste = useCallback((e: ClipboardEvent) => {
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
          setSourceImage(reader.result as string);
          setResultImage(null);
          setError(null);
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleRemoveBackground = async () => {
    if (!sourceImage) return;
    setIsProcessing(true);
    setError(null);
    setResultImage(null);

    try {
      const response = await fetch("/api/remove-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: sourceImage }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setResultImage(data.imageDataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-2 text-2xl font-bold">
        Background Removal Test (Issue #218)
      </h1>
      <p className="mb-6 text-muted-foreground">
        Upload or paste an image to test the remove.bg API integration.
      </p>

      <div className="mb-6 flex items-center gap-4">
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button asChild variant="outline">
            <span>
              <UploadIcon className="mr-2 h-4 w-4" />
              Choose Image
            </span>
          </Button>
        </label>
        <span className="text-sm text-muted-foreground">
          or paste an image from clipboard (Ctrl+V)
        </span>
      </div>

      {sourceImage && (
        <div className="mb-6">
          <Button
            onClick={handleRemoveBackground}
            disabled={isProcessing}
            size="lg"
          >
            {isProcessing ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <ImageIcon className="mr-2 h-4 w-4" />
                Remove Background
              </>
            )}
          </Button>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {sourceImage && (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              Original
            </h2>
            <div className="overflow-hidden rounded border border-border">
              <img src={sourceImage} alt="Original" className="h-auto w-full" />
            </div>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              Background Removed
            </h2>
            <div className="flex min-h-[200px] items-center justify-center overflow-hidden rounded border border-border bg-[repeating-conic-gradient(#333_0%_25%,#222_0%_50%)] bg-[length:20px_20px]">
              {resultImage ? (
                <img
                  src={resultImage}
                  alt="Background removed"
                  className="h-auto w-full"
                />
              ) : (
                <span className="text-sm text-muted-foreground">
                  {isProcessing ? "Processing..." : "Result will appear here"}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
