import Image from "next/image";
import Link from "next/link";

import { CommandeUberActivateButton } from "@/components/commande/CommandeUberActivateButton";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const BODY_TEXT = "text-zinc-900";

const btnPrimary = cn(
  segnaMontserrat.className,
  "mt-8 flex w-full max-w-sm items-center justify-center rounded-full bg-black px-6 py-3 text-center text-[15px] font-bold leading-none text-white transition hover:bg-zinc-900 active:scale-[0.99] sm:text-[16px]",
);

const btnOutline = cn(
  segnaMontserrat.className,
  "mt-8 flex w-full max-w-sm items-center justify-center rounded-full border border-black bg-white px-6 py-3 text-center text-[15px] font-bold leading-none text-black transition hover:bg-zinc-50 active:scale-[0.99] sm:text-[16px]",
);

const MONDR_PUBLIC_URL = "https://www.mondialrelay.fr/";

export type CommandeExpeditionVariant = "mondial" | "uber";

export type CommandeUberPhases = {
  preparationLine: string;
  deliveryWindowLine: string | null;
};

type CommandeExpeditionSummarySectionProps = {
  variant: CommandeExpeditionVariant;
  cartId: string;
  previsionLine: string | null;
  /** Numéro MR ou identifiant de livraison Uber. */
  trackingRef: string | null;
  /** Lien suivi (MR construit ou URL Uber). */
  trackingHref: string | null;
  /** Préparation / expédition structurées (Uber Direct). */
  uberPhases?: CommandeUberPhases | null;
};

/**
 * Bloc sous le header : visuel + prévision + suivi (Mondial Relay ou Uber Direct).
 */
export function CommandeExpeditionSummarySection({
  variant,
  cartId,
  previsionLine,
  trackingRef,
  trackingHref,
  uberPhases = null,
}: CommandeExpeditionSummarySectionProps) {
  const lineMondialDefault =
    "La livraison prévue sera indiquée dès que ton colis est prêt à l'expédition.";
  const lineUberDefault = "Colis en préparation.";

  const line1 =
    variant === "uber" && uberPhases
      ? null
      : previsionLine ?? (variant === "uber" ? lineUberDefault : lineMondialDefault);

  return (
    <section
      className={cn(
        segnaMontserrat.className,
        "flex flex-col items-center border-b border-zinc-100 bg-white px-5 pb-6 pt-3 text-center",
      )}
      aria-label="Suivi de livraison"
    >
      <div className="relative mx-auto w-full max-w-[220px] shrink-0">
        <Image
          src="/ressources/oeil_charme.png"
          alt=""
          width={480}
          height={480}
          className="mx-auto h-auto w-full max-h-[180px] object-contain"
        />
      </div>
      <div className="mt-5 max-w-[22rem] space-y-3">
        {variant === "uber" && uberPhases ? (
          <div className="space-y-1.5 text-center">
            <p className={cn("text-[15px] leading-snug", BODY_TEXT)}>{uberPhases.preparationLine}</p>
            {uberPhases.deliveryWindowLine ? (
              <p className={cn("text-[15px] font-medium leading-snug", BODY_TEXT)}>{uberPhases.deliveryWindowLine}</p>
            ) : null}
          </div>
        ) : (
          <p className={cn("text-[15px] font-normal leading-relaxed", BODY_TEXT)}>{line1}</p>
        )}

        {variant === "uber" ? (
          <>
            {trackingRef ? (
              <p className="text-[13px] leading-snug text-zinc-600">
                Référence livraison{" "}
                <span className="font-mono text-[13px] font-semibold text-zinc-900">{trackingRef}</span>
              </p>
            ) : null}
            <p className="text-[13px] leading-relaxed text-zinc-500">Suivi disponible sur Uber dès activation de la course.</p>
          </>
        ) : trackingRef ? (
          <p className={cn("text-[15px] font-normal leading-relaxed", BODY_TEXT)}>
            Suivi colis avec le numéro{" "}
            <span className="font-bold tabular-nums">{trackingRef}</span> sur Mondial Relay.
          </p>
        ) : (
          <p className={cn("text-[14px] font-normal leading-snug", BODY_TEXT)}>
            Tu recevras un numéro de suivi dès l&apos;expédition du colis. Le détail du trajet s&apos;affiche sur le site
            Mondial Relay.
          </p>
        )}
      </div>

      {variant === "uber" ? (
        trackingHref ? (
          <Link href={trackingHref} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
            Voir le suivi Uber
          </Link>
        ) : (
          <CommandeUberActivateButton cartId={cartId} />
        )
      ) : trackingHref ? (
        <Link href={trackingHref} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
          Suivre le colis
        </Link>
      ) : (
        <Link href={MONDR_PUBLIC_URL} target="_blank" rel="noopener noreferrer" className={btnOutline}>
          Ouvrir Mondial Relay
        </Link>
      )}
    </section>
  );
}
