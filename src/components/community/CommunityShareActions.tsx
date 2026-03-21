"use client";

import { Share2, UserPlus } from "lucide-react";

type CommunityShareActionsProps = {
  referralCode: string | null;
};

export function CommunityShareActions({ referralCode }: CommunityShareActionsProps) {
  const handleShare = async () => {
    const code = referralCode ?? "";
    const message = code
      ? `Rejoins-moi sur Segna avec mon code de parrainage: ${code}`
      : "Rejoins-moi sur Segna !";

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({
          title: "Segna",
          text: message,
        });
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
        return;
      }
    } catch {
      // Share cancelled: no UI feedback needed.
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          disabled
          aria-disabled
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100 px-4 text-sm font-semibold text-zinc-400"
        >
          <UserPlus size={16} />
          Add Friend
        </button>
        <button
          type="button"
          onClick={() => void handleShare()}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white text-[#5E3023] transition hover:bg-[#F8F1EC]"
          aria-label="Partager mon code"
        >
          <Share2 size={17} />
        </button>
      </div>
    </div>
  );
}
