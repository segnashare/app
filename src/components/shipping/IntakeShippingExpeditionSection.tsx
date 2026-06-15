"use client";

import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

export type IntakeShippingExpeditionSectionProps = {
  /** Moins d’espace vertical (bloc embarqué dans la page Envois). */
  compact?: boolean;
  /** Message principal sous l’œil Segna. */
  statusLine: string;
  trackingNumber: string | null;
  trackingHref: string | null;
  /** Sous-texte optionnel (ex. liste des prêts ou mutualisation retour échange). */
  detailLine?: string | null;
  /** Libellé du bouton suivi (défaut : « Suivre l'envoi »). */
  trackingCtaLabel?: string;
  piggybackOrderCompact?: string | null;
  returnHref?: string | null;
};

export { resolveIntakeMemberTrackingHref as resolveIntakeTrackingHref } from "@/lib/shipping/intake-carrier-tracking";

/**
 * Bloc expédition intake membre → Segna (œil Segna, suivi, CTA).
 */
export function IntakeShippingExpeditionSection({
  compact = false,
  statusLine,
  trackingNumber,
  trackingHref,
  detailLine,
  trackingCtaLabel = "Suivre l'envoi",
  piggybackOrderCompact,
  returnHref,
}: IntakeShippingExpeditionSectionProps) {
  return (
    <section
      className={cn(
        segnaMontserrat.className,
        "flex flex-1 flex-col items-center text-center",
        compact ? "gap-5 px-4 pb-6 pt-6" : "gap-8 px-5 pb-10 pt-10",
      )}
      aria-label="Suivi expédition"
    >
      <Image
        src="/ressources/oeil_charme.png"
        alt=""
        width={480}
        height={480}
        className={cn(
          "mx-auto h-auto w-full object-contain",
          compact ? "max-h-[120px] max-w-[160px]" : "max-h-[150px] max-w-[200px]",
        )}
        priority
      />
      <div className={cn("max-w-[22rem]", compact ? "space-y-2.5" : "space-y-3")}>
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
          {trackingCtaLabel}
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
