"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Share2 } from "lucide-react";

import {
  CmsFrameLayoutModeProvider,
  ShopWideLinkCardBlock,
} from "@/components/cms/CmsSectionBlocks";
import { shareReferralInviteNative } from "@/components/community/referralShareNative";
import { buildReferralInviteUrl } from "@/components/community/referralShareMessage";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const STEPS: string[] = [
  "Partage ton lien d’invitation.",
  "Ton amie crée son compte sur Segna.",
  "Tu gagnes un échange inclus (livraison et frais offerts).",
];

type CommunityShareActionsProps = {
  referralCode: string | null;
  /** Première frame `shop_link_card` de la section CMS `profile_referral_banner` (page Autre BO). */
  referralBannerRow?: CmsFrameRow | null;
};

export function CommunityShareActions({ referralCode, referralBannerRow = null }: CommunityShareActionsProps) {
  const montserrat = segnaMontserrat;
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(typeof window !== "undefined" ? window.location.origin : "");
  }, []);

  const inviteUrl = useMemo(() => {
    if (!origin) return "";
    return buildReferralInviteUrl(origin, referralCode);
  }, [origin, referralCode]);

  const handleCopyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const showCmsBanner = referralBannerRow?.frame_type === "shop_link_card";

  return (
    <section className={cn(montserrat.className, "w-full min-w-0")}>
      <div className="referral-silver-frame-outer">
        <div className="referral-silver-frame-inner overflow-hidden bg-white shadow-sm ring-1 ring-zinc-200/50">
        {/* Marge autour de la bulle ; espace modéré sous l’image avant le titre. */}
        <div className="px-5 pt-5 pb-4">
          {showCmsBanner ? (
            <CmsFrameLayoutModeProvider mode="stack">
              <ShopWideLinkCardBlock
                payload={referralBannerRow.payload}
                aspectClassName="aspect-[2.35] min-h-[108px] w-full"
                wrapperClassName="block w-full overflow-hidden rounded-3xl"
                visualOnly
                asStatic
                surfaceRadiusClassName="rounded-3xl"
              />
            </CmsFrameLayoutModeProvider>
          ) : (
            <div
              className="aspect-[2.35] min-h-[108px] w-full overflow-hidden rounded-3xl bg-gradient-to-br from-sky-300 via-indigo-200 to-violet-300 shadow-sm ring-1 ring-zinc-200/90"
              aria-hidden
            />
          )}
        </div>

        <div className="space-y-4 px-5 pb-6 pt-0">
          <header className="space-y-1.5 text-left">
            <h3 className={cn("min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
              Invite une amie
            </h3>
            <p className="text-sm font-medium leading-snug text-zinc-600">
              Invite une amie à rejoindre le dressing partagé Segna.
            </p>
          </header>

          <ul className="list-outside list-disc space-y-2.5 pl-5 text-[13px] font-medium leading-snug text-zinc-800 marker:text-zinc-900">
            {STEPS.map((text) => (
              <li key={text} className="pl-0.5">
                {text}
              </li>
            ))}
          </ul>

          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Ton lien d’invitation</p>
            <div className="flex min-h-[44px] items-center gap-1 rounded-full bg-zinc-200/95 p-1 pl-2 ring-1 ring-zinc-300/80">
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                disabled={!inviteUrl}
                className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-full text-zinc-800 transition hover:bg-white/90 disabled:opacity-40"
                aria-label="Copier le lien d’invitation"
              >
                <Copy className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              </button>
              <p className="min-w-0 flex-1 truncate px-1 text-left text-[11px] font-semibold leading-tight text-zinc-800">
                {copied ? "Copié !" : inviteUrl || "—"}
              </p>
              <button
                type="button"
                onClick={() => void shareReferralInviteNative(referralCode)}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-black px-4 py-2 text-[13px] font-bold text-white transition hover:bg-zinc-900"
              >
                <Share2 className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
                Share
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
