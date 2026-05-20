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

function buildMondialRelayTrackingUrl(trackingNumber: string): string {
  return `https://www.mondialrelay.com/suivi-de-colis/?code=${encodeURIComponent(trackingNumber.trim())}`;
}

export function resolveIntakeTrackingHref(
  trackingNumber: string | null | undefined,
  trackingUrl: string | null | undefined,
): { trackingNumber: string | null; trackingHref: string | null } {
  const num = typeof trackingNumber === "string" ? trackingNumber.trim() : "";
  const url = typeof trackingUrl === "string" ? trackingUrl.trim() : "";
  if (url.startsWith("http")) {
    return { trackingNumber: num || null, trackingHref: url };
  }
  if (num) {
    return { trackingNumber: num, trackingHref: buildMondialRelayTrackingUrl(num) };
  }
  return { trackingNumber: null, trackingHref: null };
}

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
        "flex flex-col items-center px-5 pb-8 pt-4 text-center",
      )}
      aria-label="Suivi expédition"
    >
      <Image
        src="/ressources/oeil_charme.png"
        alt=""
        width={480}
        height={480}
        className="mx-auto h-auto w-full max-h-[160px] max-w-[200px] object-contain"
        priority
      />
      <div className="mt-4 max-w-[22rem] space-y-2">
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
            "mt-6 flex h-12 w-full max-w-sm items-center justify-center gap-2 rounded-full bg-zinc-900 text-[15px] font-bold text-white",
          )}
        >
          Suivre le colis
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      ) : null}
      {piggybackOrderCompact && returnHref ? (
        <Link
          href={returnHref}
          className="mt-4 text-[14px] font-semibold text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
        >
          Retour échange {piggybackOrderCompact}
        </Link>
      ) : null}
    </section>
  );
}
