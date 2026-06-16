"use client";

import { Loader2, UserPlus, UserCheck } from "lucide-react";
import { useState } from "react";

import { toggleMemberFollow } from "@/lib/community/community-actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type MemberFollowButtonProps = {
  userId: string;
  initialFollowing: boolean;
  className?: string;
};

export function MemberFollowButton({ userId, initialFollowing, className }: MemberFollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  async function handleToggle() {
    if (busy) return;
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const result = await toggleMemberFollow(supabase, userId);
    if (result) setFollowing(result.following);
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={() => void handleToggle()}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-medium shadow-sm transition",
        following
          ? "border border-zinc-200 bg-zinc-100 text-zinc-700"
          : "border border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800",
        className,
      )}
      aria-pressed={following}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : following ? (
        <UserCheck className="h-4 w-4" aria-hidden />
      ) : (
        <UserPlus className="h-4 w-4" aria-hidden />
      )}
      {following ? "Suivie" : "Suivre"}
    </button>
  );
}
