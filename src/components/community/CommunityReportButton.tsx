"use client";

import { Flag, Loader2 } from "lucide-react";
import { useState } from "react";

import { reportCommunityInspiration } from "@/lib/community/community-actions";
import type { InspirationSource } from "@/lib/community/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type CommunityReportButtonProps = {
  source: InspirationSource;
  inspirationId: string;
  className?: string;
};

const REASONS = ["Contenu inapproprié", "Spam", "Harcèlement", "Autre"];

export function CommunityReportButton({ source, inspirationId, className }: CommunityReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(reason: string) {
    if (busy) return;
    setBusy(true);
    const ok = await reportCommunityInspiration(createSupabaseBrowserClient(), source, inspirationId, reason);
    setBusy(false);
    if (ok) {
      setDone(true);
      setOpen(false);
    }
  }

  if (done) {
    return <p className={cn("text-[13px] text-zinc-500", className)}>Signalement envoyé. Merci.</p>;
  }

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-600"
      >
        <Flag className="h-4 w-4" aria-hidden />
        Signaler
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg">
          {busy ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : (
            REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => void submit(reason)}
                className="block w-full rounded-xl px-3 py-2 text-left text-[13px] text-zinc-800 hover:bg-zinc-50"
              >
                {reason}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
