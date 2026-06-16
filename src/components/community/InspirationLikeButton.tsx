"use client";

import { Heart, Loader2 } from "lucide-react";
import { useState } from "react";

import { toggleInspirationLike } from "@/lib/community/community-actions";
import type { InspirationSource } from "@/lib/community/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type InspirationLikeButtonProps = {
  source: InspirationSource;
  inspirationId: string;
  initialLiked: boolean;
  initialCount: number;
  className?: string;
};

export function InspirationLikeButton({
  source,
  inspirationId,
  initialLiked,
  initialCount,
  className,
}: InspirationLikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function handleToggle() {
    if (busy) return;
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const result = await toggleInspirationLike(supabase, source, inspirationId);
    if (result) {
      setLiked(result.liked);
      setCount(result.like_count);
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={() => void handleToggle()}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-[14px] font-medium text-zinc-900 shadow-sm transition hover:bg-zinc-50",
        className,
      )}
      aria-pressed={liked}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Heart className={cn("h-4 w-4", liked && "fill-rose-500 text-rose-500")} aria-hidden />
      )}
      <span>{liked ? "J’adore" : "J’adore"}</span>
      <span className="text-zinc-500">{count}</span>
    </button>
  );
}
