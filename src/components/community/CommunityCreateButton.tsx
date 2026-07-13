"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { createInspirationHref } from "@/lib/community/create-inspiration-href";
import { cn } from "@/lib/utils/cn";

export function CommunityCreateButton({
  className,
  returnTo = "/community",
}: {
  className?: string;
  returnTo?: string;
}) {
  return (
    <Link
      href={createInspirationHref(returnTo)}
      aria-label="Créer une inspi"
      className={cn(
        "group inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-900 text-white shadow-sm",
        "transition-[width,padding,gap] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
        "hover:w-[7.25rem] hover:justify-start hover:gap-1.5 hover:px-4",
        "focus-visible:w-[7.25rem] focus-visible:justify-start focus-visible:gap-1.5 focus-visible:px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2",
        className,
      )}
    >
      <Plus className="h-4 w-4 shrink-0" aria-hidden />
      <span
        className={cn(
          "max-w-0 overflow-hidden whitespace-nowrap text-[13px] font-medium opacity-0",
          "transition-[max-width,opacity,margin] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
          "group-hover:max-w-[4rem] group-hover:opacity-100",
          "group-focus-visible:max-w-[4rem] group-focus-visible:opacity-100",
        )}
      >
        Créer
      </span>
    </Link>
  );
}
