"use client";

import Link from "next/link";

import { cn } from "@/lib/utils/cn";

export type ProfileCompleteMode = "edit" | "view";

type ProfileCompleteHeaderProps = {
  backTab: "plus" | "security" | "me";
  displayName: string;
  completionScore: number;
  mode: ProfileCompleteMode;
  onModeChange: (mode: ProfileCompleteMode) => void;
  onDone?: () => void;
};

export function ProfileCompleteHeader({
  backTab,
  displayName,
  completionScore,
  mode,
  onModeChange,
  onDone,
}: ProfileCompleteHeaderProps) {
  return (
    <header className="w-full px-1 pt-5">
      <div className="w-full p-2">
        <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
          <Link href={`/profile?tab=${backTab}`} className="justify-self-start px-2 text-[20px] font-bold text-[#5E3023]">
            Annuler
          </Link>
          <div className="px-3 py-1 text-center">
            <p className="text-[24px] font-semibold leading-none text-zinc-900">{displayName}</p>
            <p className={cn("mt-1 text-[18px] font-semibold", completionScore >= 100 ? "text-emerald-600" : "text-[#E44D3E]")}>
              {completionScore} % Terminé
            </p>
          </div>
          {onDone ? (
            <button type="button" onClick={onDone} className="justify-self-end px-2 text-[20px] font-bold text-[#5E3023]">
              Terminé
            </button>
          ) : (
            <Link href={`/profile?tab=${backTab}`} className="justify-self-end px-2 text-[20px] font-bold text-[#5E3023]">
              Terminé
            </Link>
          )}
        </div>
      </div>

      <div className="-mx-5 mt-1 w-[calc(100%+2.5rem)] px-1">
        <div className="grid w-full grid-cols-2">
        <button
          type="button"
          onClick={() => onModeChange("edit")}
          className={cn(
            "h-12 border-b-2 text-[20px] font-extrabold",
            mode === "edit" ? "border-[#5E3023] text-[#5E3023]" : "border-transparent text-zinc-300",
          )}
        >
          Modifier
        </button>
        <button
          type="button"
          onClick={() => onModeChange("view")}
          className={cn(
            "h-12 border-b-2 text-[20px] font-extrabold",
            mode === "view" ? "border-[#5E3023] text-[#5E3023]" : "border-transparent text-zinc-300",
          )}
        >
          Voir
        </button>
        </div>
      </div>
    </header>
  );
}
