import type { ReactNode } from "react";

import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

/** Vignette carrée 100px — alignée `ITEM_LIST_SQUARE_THUMB_FRAME_CLASS`. */
const LIST_THUMB_CLASS = "aspect-square w-[100px] shrink-0 rounded-md";

function ExchangeLoadingListRow() {
  return (
    <div className="px-5 py-2">
      <div className="grid w-full grid-cols-[100px_minmax(0,50%)_auto] items-center gap-1 py-2">
        <SegnaSkeletonBlock className={LIST_THUMB_CLASS} rounded="rounded-md" />
        <div className="flex min-w-0 flex-col gap-1.5 px-1">
          <SegnaSkeletonBlock className="h-[18px] w-[min(100%,11rem)] rounded-md" rounded="rounded-md" />
          <SegnaSkeletonBlock className="h-3.5 w-14 rounded-md" rounded="rounded-md" />
          <SegnaSkeletonBlock className="h-5 w-16 rounded-md" rounded="rounded-md" />
        </div>
        <SegnaSkeletonBlock className="h-9 w-9 shrink-0 rounded-md" rounded="rounded-md" />
      </div>
    </div>
  );
}

function ExchangeLoadingSection({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="w-full space-y-3 bg-white px-5 py-4" aria-hidden>
      <h2 className={cn("min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>{title}</h2>
      <div className="-mx-5 divide-y-[1px] divide-zinc-200">{children}</div>
      {footer}
    </section>
  );
}

/** Squelette fidèle à `/exchange` : header Guest + wallet, Panier, promo, Prêts (listes horizontales). */
export function ExchangeLoadingFallback() {
  return (
    <div className="min-h-0 bg-white pb-28 text-zinc-900" aria-busy aria-label="Chargement de l’échange">
      <div className="sticky top-0 z-30 bg-white">
        <header className="flex items-start justify-between gap-3 px-5 pb-4 pt-8">
          <SegnaSkeletonBlock className="h-9 w-28 rounded-md" rounded="rounded-md" />
          <SegnaSkeletonBlock className="h-10 w-[4.5rem] rounded-full" rounded="rounded-full" />
        </header>
      </div>

      <div className="flex flex-col space-y-[4.5px] bg-zinc-100">
        <ExchangeLoadingSection
          title="Panier"
          footer={
            <div className="flex justify-end pt-1">
              <SegnaSkeletonBlock className="h-9 w-40 rounded-full" rounded="rounded-full" />
            </div>
          }
        >
          <ExchangeLoadingListRow />
        </ExchangeLoadingSection>

        <section className="w-full bg-white px-5 py-4" aria-hidden>
          <SegnaSkeletonBlock className="aspect-[2.12] w-full rounded-2xl" />
        </section>

        <ExchangeLoadingSection
          title="Prêts"
          footer={
            <div className="flex justify-end py-0.5">
              <SegnaSkeletonBlock className="h-9 w-36 rounded-full" rounded="rounded-full" />
            </div>
          }
        >
          <ExchangeLoadingListRow />
          <ExchangeLoadingListRow />
        </ExchangeLoadingSection>
      </div>
    </div>
  );
}
