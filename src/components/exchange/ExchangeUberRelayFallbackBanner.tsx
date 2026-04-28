"use client";

import Link from "next/link";

import { getSegnaSupportContact } from "@/lib/config/support-contact";
import { cn } from "@/lib/utils/cn";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";

/**
 * Uber Direct prévu mais course non créée (ou prérequis manquant) : commande confirmée, aller à finaliser en relais avec le support.
 */
export function ExchangeUberRelayFallbackBanner() {
  const { email } = getSegnaSupportContact();
  const mailHref = email ? `mailto:${email}?subject=${encodeURIComponent("Livraison aller — passage en point relais")}` : null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-amber-300/90 bg-amber-50/95 px-4 py-3.5 shadow-[0_6px_20px_rgba(245,158,11,0.12)]",
      )}
      role="alert"
    >
      <h2
        className={cn(
          "text-[18px] font-bold leading-snug text-amber-950",
          segnaPlayfairDisplay.className,
          SEGNA_SECTION_TITLE_CLASSNAME,
        )}
      >
        Livraison à domicile non confirmée
      </h2>
      <p className="mt-1.5 text-[13px] font-medium leading-snug text-amber-950/90">
        Ta commande est bien enregistrée. Uber n’a pas pu réserver l’aller automatiquement. L’équipe Segna te proposera
        une livraison en <strong className="font-semibold">point relais Mondial Relay</strong> (ou une alternative) —
        écris-nous en indiquant ton numéro de commande.
      </p>
      {mailHref ? (
        <Link
          href={mailHref}
          className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-amber-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-900"
        >
          Contacter le support
        </Link>
      ) : null}
    </div>
  );
}
