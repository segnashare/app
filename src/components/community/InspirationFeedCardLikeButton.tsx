"use client";

import { Heart, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { toggleInspirationLike } from "@/lib/community/community-actions";
import type { InspirationSource } from "@/lib/community/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type InspirationFeedCardLikeButtonProps = {
  source: InspirationSource;
  inspirationId: string;
  initialLiked: boolean;
  className?: string;
  onLikeChange?: (liked: boolean) => void;
};

export function InspirationFeedCardLikeButton({
  source,
  inspirationId,
  initialLiked,
  className,
  onLikeChange,
}: InspirationFeedCardLikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLiked(initialLiked);
  }, [initialLiked, inspirationId]);

  async function handleToggle() {
    if (busy) return;
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const result = await toggleInspirationLike(supabase, source, inspirationId);
    if (result) {
      setLiked(result.liked);
      onLikeChange?.(result.liked);
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleToggle();
      }}
      disabled={busy}
      className={cn(
        "pointer-events-auto inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-0 transition-opacity disabled:opacity-50",
        className,
      )}
      aria-pressed={liked}
      aria-label={liked ? "Retirer des coups de cœur" : "Ajouter aux coups de cœur"}
    >
      {busy ? (
        <Loader2
          className="h-4 w-4 animate-spin text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
          aria-hidden
        />
      ) : (
        <Heart
          className={cn(
            "h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]",
            liked ? "fill-white" : "fill-none",
          )}
          strokeWidth={2}
          aria-hidden
        />
      )}
    </button>
  );
}
