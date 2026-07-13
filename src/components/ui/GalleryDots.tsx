import { cn } from "@/lib/utils/cn";

type GalleryDotsProps = {
  count: number;
  activeIndex: number;
  variant?: "inline" | "fullscreen";
  className?: string;
};

export function GalleryDots({
  count,
  activeIndex,
  variant = "inline",
  className,
}: GalleryDotsProps) {
  if (count <= 1) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-4 z-10 flex items-center justify-center gap-1.5",
        variant === "fullscreen" && "bottom-8",
        className,
      )}
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            "rounded-full transition-all duration-200",
            i === activeIndex
              ? variant === "fullscreen"
                ? "h-1.5 w-7 rounded-full bg-white"
                : "h-1.5 w-6 rounded-sm bg-zinc-900"
              : variant === "fullscreen"
                ? "h-1.5 w-1.5 rounded-full bg-white/45"
                : "h-1.5 w-1.5 bg-zinc-900/30",
          )}
        />
      ))}
    </div>
  );
}
