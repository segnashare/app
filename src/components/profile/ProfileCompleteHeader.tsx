"use client";

import Link from "next/link";

import { cn } from "@/lib/utils/cn";

type ProfileCompleteHeaderProps = {
  exitHref: string;
  onDone?: () => void;
  doneDisabled?: boolean;
};

export function ProfileCompleteHeader({
  exitHref,
  onDone,
  doneDisabled = false,
}: ProfileCompleteHeaderProps) {
  return (
    <header className="w-full px-1 pt-3">
      <div className="flex w-full items-center justify-between gap-2 p-2">
        <Link href={exitHref} className="px-2 text-[20px] font-bold text-zinc-900">
          Annuler
        </Link>
        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            aria-disabled={doneDisabled}
            className={cn(
              "px-2 text-[20px] font-bold",
              doneDisabled ? "cursor-pointer text-zinc-300" : "text-zinc-900",
            )}
          >
            Terminé
          </button>
        ) : (
          <Link href={exitHref} className="px-2 text-[20px] font-bold text-zinc-900">
            Terminé
          </Link>
        )}
      </div>
    </header>
  );
}
