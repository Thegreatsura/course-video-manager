import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      position="bottom-left"
      closeButton
      // The floor every toast stands on, however it was made: long unbroken
      // strings (URLs, paths, JSON) wrap instead of widening the toast, and no
      // title or description outgrows half the screen; past that it scrolls.
      // The four-line clamp, "Show more" and "Copy" live in ./toast.tsx.
      toastOptions={{
        classNames: {
          content: "min-w-0",
          title:
            "max-h-[50vh] min-w-0 overflow-y-auto [overflow-wrap:anywhere]",
          description:
            "max-h-[50vh] min-w-0 overflow-y-auto [overflow-wrap:anywhere]",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
