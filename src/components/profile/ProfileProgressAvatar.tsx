"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { useId } from "react";

import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";

type ProfileProgressAvatarProps = {
  completionScore: number;
  avatarUrl: string | null;
  avatarTransform?: {
    offset: { x: number; y: number };
    zoom: number;
  };
  displayName: string;
  onPhotoClick: () => void;
  editHref: string;
};

export function ProfileProgressAvatar({ completionScore, avatarUrl, avatarTransform, displayName, onPhotoClick, editHref }: ProfileProgressAvatarProps) {
  const ringGradientId = useId().replace(/:/g, "");
  const progressStroke = 440;
  const clampedScore = Math.max(0, Math.min(100, Math.round(completionScore)));
  const progressOffset = progressStroke - (clampedScore / 100) * progressStroke;
  const offsetX = avatarTransform?.offset.x ?? 0;
  const offsetY = avatarTransform?.offset.y ?? 0;
  const zoom = avatarTransform?.zoom ?? 1;

  return (
    <div className="relative inline-flex h-44 w-44 items-center justify-center">
      <svg viewBox="0 0 160 160" className="absolute inset-0 h-full w-full -rotate-90">
        <defs>
          <linearGradient id={ringGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#27272a" />
            <stop offset="100%" stopColor="#18181b" />
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="8" className="text-zinc-200" fill="none" />
        <circle
          cx="80"
          cy="80"
          r="70"
          stroke={`url(#${ringGradientId})`}
          strokeWidth="8"
          className="transition-all duration-500 ease-out"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={progressStroke}
          strokeDashoffset={progressOffset}
        />
      </svg>

      <button
        type="button"
        onClick={onPhotoClick}
        aria-label="Modifier la photo de profil"
        className="relative h-32 w-32 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
      >
        {avatarUrl ? (
          <RemoteCoverThumb
            photoUrl={avatarUrl}
            frameClassName="h-full w-full rounded-full"
            photoPosition={{
              offset: { x: offsetX, y: offsetY },
              zoom,
            }}
            photoCoverFill
            className="rounded-full"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-5xl font-semibold text-zinc-600">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        )}

        {clampedScore < 100 ? (
          <span className="absolute bottom-2 left-1/2 inline-flex h-6 -translate-x-1/2 items-center justify-center rounded-[7px] bg-gradient-to-b from-zinc-800 to-zinc-950 px-1 text-white shadow-[0_6px_14px_rgba(0,0,0,0.16)]">
            <span className="text-[16px] font-medium leading-none tracking-[-0.01em] tabular-nums">{clampedScore} %</span>
          </span>
        ) : null}
      </button>

      <Link
        href={editHref}
        aria-label="Completer le profil"
        className="absolute right-1 top-1 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
      >
        <Pencil size={20} strokeWidth={2.3} />
      </Link>
    </div>
  );
}
