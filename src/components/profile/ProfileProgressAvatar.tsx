"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";

import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";

type ProfileProgressAvatarProps = {
  avatarUrl: string | null;
  avatarTransform?: {
    offset: { x: number; y: number };
    zoom: number;
  };
  displayName: string;
  onPhotoClick: () => void;
  editHref: string;
};

export function ProfileProgressAvatar({
  avatarUrl,
  avatarTransform,
  displayName,
  onPhotoClick,
  editHref,
}: ProfileProgressAvatarProps) {
  const offsetX = avatarTransform?.offset.x ?? 0;
  const offsetY = avatarTransform?.offset.y ?? 0;
  const zoom = avatarTransform?.zoom ?? 1;

  return (
    <div className="relative inline-flex h-32 w-32 items-center justify-center">
      <button
        type="button"
        onClick={onPhotoClick}
        aria-label="Modifier la photo de profil"
        className="relative z-0 h-32 w-32 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
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
      </button>

      <Link
        href={editHref}
        aria-label="Completer le profil"
        className="absolute -right-1 -top-1 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
      >
        <Pencil size={20} strokeWidth={2.3} />
      </Link>
    </div>
  );
}
