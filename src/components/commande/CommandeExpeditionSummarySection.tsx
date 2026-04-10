import Image from "next/image";
import Link from "next/link";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const BODY_TEXT = "text-zinc-900";

const btnTrack = cn(
  segnaMontserrat.className,
  "mt-8 flex w-full max-w-sm items-center justify-center rounded-full bg-black px-6 py-3 text-center text-[15px] font-bold leading-none text-white transition hover:bg-zinc-900 active:scale-[0.99] sm:text-[16px]",
);

const btnMondialOutline = cn(
  segnaMontserrat.className,
  "mt-8 flex w-full max-w-sm items-center justify-center rounded-full border border-black bg-white px-6 py-3 text-center text-[15px] font-bold leading-none text-black transition hover:bg-zinc-50 active:scale-[0.99] sm:text-[16px]",
);

const MONDR_PUBLIC_URL = "https://www.mondialrelay.fr/";

type CommandeExpeditionSummarySectionProps = {
  previsionLine: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
};

/**
 * Bloc sous le header (logique proche de l’emprunt) : visuel œil + livraison prévue + suivi + CTA Mondial Relay.
 */
export function CommandeExpeditionSummarySection({
  previsionLine,
  trackingNumber,
  trackingUrl,
}: CommandeExpeditionSummarySectionProps) {
  const line1Default =
    "La livraison prévue sera indiquée dès que ton colis est prêt à l'expédition.";
  const line1 = previsionLine ?? line1Default;
  const lineNoTracking =
    "Tu recevras un numéro de suivi dès l'expédition du colis. Le détail du trajet s'affiche sur le site Mondial Relay.";

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
        <p className={cn("text-[15px] font-normal leading-relaxed", BODY_TEXT)}>{line1}</p>
        {trackingNumber ? (
          <p className={cn("text-[15px] font-normal leading-relaxed", BODY_TEXT)}>
            Suivez votre colis avec le numéro{" "}
            <span className="font-bold tabular-nums">{trackingNumber}</span> sur Mondial Relay.
          </p>
        ) : (
          <p className={cn("text-[14px] font-normal leading-snug", BODY_TEXT)}>{lineNoTracking}</p>
        )}
      </div>
      {trackingUrl ? (
        <Link href={trackingUrl} target="_blank" rel="noopener noreferrer" className={btnTrack}>
          Suivre le colis
        </Link>
      ) : (
        <Link href={MONDR_PUBLIC_URL} target="_blank" rel="noopener noreferrer" className={btnMondialOutline}>
          Ouvrir Mondial Relay
        </Link>
      )}
    </section>
  );
}
