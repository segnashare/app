"use client";

import Image from "next/image";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import {
  VerificationPackageLineRows,
  type VerificationPackageLine,
} from "@/components/verification/VerificationPackageLineRows";
import type { MemberIntakeVerificationSnapshot } from "@/lib/items/member-intake-verification";
import { formatDateParis } from "@/lib/datetime/segna-datetime";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const playfair = segnaPlayfairDisplay;

type Props = {
  snapshot: MemberIntakeVerificationSnapshot;
};

export function MemberIntakeVerificationContent({ snapshot }: Props) {
  const router = useRouter();
  const receivedLabel = snapshot.receivedAtIso
    ? formatDateParis(snapshot.receivedAtIso, { dateStyle: "long" })
    : null;

  const lines: VerificationPackageLine[] = useMemo(
    () =>
      snapshot.items.map((item) => ({
        id: item.id,
        itemId: item.id,
        itemName: item.title,
        brand: item.brand,
        description: item.description,
        pricePoints: item.pricePoints,
        photoUrl: item.photoUrl,
        photoPosition: item.photoPosition,
        fulfillmentStage: item.fulfillmentStage,
      })),
    [snapshot.items],
  );

  const totalPoints = useMemo(
    () => snapshot.items.reduce((sum, item) => sum + Math.max(0, item.pricePoints), 0),
    [snapshot.items],
  );

  const pageSubtitle = useMemo(() => {
    const count = snapshot.items.length;
    if (count <= 1) return "Ton prêt est en cours de vérification chez Segna.";
    return `Tes ${count} prêts sont en cours de vérification chez Segna.`;
  }, [snapshot.items.length]);

  return (
    <main className={cn(montserrat.className, "flex min-h-[100dvh] w-full flex-col bg-white")}>
      <header className="fixed left-1/2 top-0 z-[60] w-full max-w-[430px] -translate-x-1/2 border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => router.push("/exchange")}
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900"
              aria-label="Retour"
            >
              <ChevronLeft className="h-8 w-8" strokeWidth={2.25} />
            </button>
            <span className="h-12 w-12 shrink-0" aria-hidden />
          </div>
          <h1 className={cn("mt-5", playfair.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Vérification Segna</h1>
          <p className={cn(montserrat.className, "mt-1.5 text-[17px] font-medium leading-snug text-zinc-600")}>
            {pageSubtitle}
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[430px] shrink-0 bg-white pt-[180px]" aria-hidden />

      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col gap-6 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]">
        <section className="flex flex-col items-center pt-5 text-center" aria-label="Réception du colis">
          <Image
            src="/ressources/oeil_charme.png"
            alt=""
            width={480}
            height={480}
            className="mx-auto h-auto w-full max-h-[140px] max-w-[180px] object-contain"
            priority
          />
          <div className="mt-5 max-w-[22rem] space-y-2.5">
            <p className="text-[15px] font-medium leading-snug text-zinc-900">Segna a bien reçu ton colis.</p>
            {receivedLabel ? (
              <p className="text-[14px] leading-relaxed text-zinc-600">Réception le {receivedLabel}.</p>
            ) : null}
            {snapshot.trackingNumber ? (
              <p className="text-[14px] leading-snug text-zinc-600">
                N° de suivi{" "}
                {snapshot.trackingHref ? (
                  <a
                    href={snapshot.trackingHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[14px] font-semibold tabular-nums text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-800"
                  >
                    {snapshot.trackingNumber}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  </a>
                ) : (
                  <span className="font-mono text-[14px] font-semibold tabular-nums text-zinc-900">
                    {snapshot.trackingNumber}
                  </span>
                )}
              </p>
            ) : null}
            <p className="text-[14px] leading-relaxed text-zinc-600">
              Les crédits liés à tes prêts seront ajoutés à ton wallet après la bonne vérification
              des pièces prêtées.
            </p>
          </div>
        </section>

        <section className="pt-2" aria-label="Pièces du colis">
          <h2 className={cn("mb-3 min-w-0", playfair.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Pièces du colis</h2>
          {lines.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucune pièce.</p>
          ) : (
            <VerificationPackageLineRows
              lines={lines}
              creditKind="exchange"
              itemHrefSuffix="?from=verification"
              pointsUnitDisplay="icon"
            />
          )}
          {totalPoints > 0 ? (
            <div className="mt-4 flex items-center justify-between gap-3 pt-2">
              <span className="text-[16px] font-bold text-zinc-900">Total prêt</span>
              <SegnaPointsUnitDisplay
                points={totalPoints}
                creditKind="exchange"
                unitDisplay="icon"
                numberClassName="text-[17px] font-bold text-zinc-900"
              />
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
