"use client";

import { cn } from "@/lib/utils/cn";

const TRUSTPILOT_REVIEW_URL = "https://fr.trustpilot.com/review/segnashare.com";
const TRUSTPILOT_LOGO_SRC = "/ressources/icons/trustpilot.svg";

type TrustpilotReviewCtaProps = {
  className?: string;
  /** Dans une coquille déjà bordée (profil à côté de Google) : pas de double cadre. */
  variant?: "default" | "inset";
};

export function TrustpilotReviewCta({ className, variant = "default" }: TrustpilotReviewCtaProps) {
  const isInset = variant === "inset";
  return (
    <a
      href={TRUSTPILOT_REVIEW_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Laisser un avis sur Trustpilot"
      className={cn(
        "flex w-full min-w-0 items-center justify-center gap-2 font-semibold text-zinc-900 transition",
        isInset
          ? "h-full min-h-0 rounded-none border-0 bg-transparent px-1 py-0 shadow-none hover:bg-zinc-100/70 active:bg-zinc-100"
          : "h-14 rounded-xl border border-zinc-200 bg-white px-2 shadow-sm hover:border-zinc-300 hover:bg-zinc-50 sm:gap-2.5 sm:px-3",
        className,
      )}
    >
      <img
        src={TRUSTPILOT_LOGO_SRC}
        alt=""
        width={20}
        height={20}
        className="h-5 w-5 shrink-0 object-contain"
        decoding="async"
      />
      <span className="truncate text-[13px] leading-tight tracking-tight">Laisser un avis</span>
    </a>
  );
}
