"use client";

import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

export type IntakeShippingExpeditionSectionProps = {
  /** Message principal sous l’œil Segna. */
  statusLine: string;
  trackingNumber: string | null;
  trackingHref: string | null;
  /** Sous-texte optionnel (ex. mutualisation retour échange). */
  detailLine?: string | null;
  piggybackOrderCompact?: string | null;
  returnHref?: string | null;
};

export { resolveIntakeMemberTrackingHref as resolveIntakeTrackingHref } from "@/lib/shipping/intake-carrier-tracking";

/**
 * Bloc expédition intake membre → Segna (œil Segna, suivi, CTA).
 */
export function IntakeShippingExpeditionSection({
  statusLine,
  trackingNumber,
  trackingHref,
  detailLine,
  piggybackOrderCompact,
  returnHref,
}: IntakeShippingExpeditionSectionProps) {
  return (
    <section
      className={cn(
        segnaMontserrat.className,
        "flex flex-1 flex-col items-center gap-14 px-5 pb-16 pt-16 text-center",
      )}
      aria-label="Suivi expédition"
    >
      <Image
        src="/ressources/oeil_charme.png"
        alt=""
        width={480}
        height={480}
        className="mx-auto h-auto w-full max-h-[180px] max-w-[220px] object-contain"
        priority
      />
      <div className="max-w-[22rem] space-y-4">
        <p className="text-[15px] font-medium leading-snug text-zinc-900">{statusLine}</p>
        {detailLine ? (
          <p className="text-[14px] leading-relaxed text-zinc-600">{detailLine}</p>
        ) : null}
        {trackingNumber ? (
          <p className="text-[14px] leading-snug text-zinc-600">
            N° de suivi{" "}
            {trackingHref ? (
              <a
                href={trackingHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[14px] font-semibold tabular-nums text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-800"
              >
                {trackingNumber}
              </a>
            ) : (
              <span className="font-mono text-[14px] font-semibold tabular-nums text-zinc-900">
                {trackingNumber}
              </span>
            )}
          </p>
        ) : (
          <p className="text-[14px] leading-snug text-zinc-500">
            Le numéro de suivi apparaîtra dès qu&apos;il est transmis par le transporteur.
          </p>
        )}
      </div>
      {trackingHref ? (
        <Link
          href={trackingHref}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            segnaMontserrat.className,
            "flex h-12 w-full max-w-sm items-center justify-center gap-2 rounded-full bg-zinc-900 text-[15px] font-bold text-white",
          )}
        >
          Suivre le colis
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      ) : null}
      {piggybackOrderCompact && returnHref ? (
        <Link
          href={returnHref}
          className="mt-6 text-[14px] font-semibold text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
        >
          Retour échange {piggybackOrderCompact}
        </Link>
      ) : null}
    </section>
  );
}
