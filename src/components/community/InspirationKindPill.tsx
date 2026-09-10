import type { StyleLookEntryKind } from "@/lib/community/inspiration-member-tag";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type InspirationKindPillProps = {
  entryKind?: StyleLookEntryKind | null;
  className?: string;
};

export function InspirationKindPill({ entryKind, className }: InspirationKindPillProps) {
  if (entryKind !== "inspi") return null;

  return (
    <span
      className={cn(
        segnaPlayfairDisplay.className,
        "pointer-events-none z-10 rounded-full border border-white bg-transparent px-1.5 py-px text-[11px] font-normal leading-none text-white",
        className,
      )}
    >
      Inspi
    </span>
  );
}
