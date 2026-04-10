import Link from "next/link";

import { X } from "lucide-react";

import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type CommandeRetourPlaceholderViewProps = {
  cartId: string;
  orderNumberCompact: string;
  /** @default retour */
  variant?: "retour" | "prolonger";
};

const VARIANT_COPY = {
  retour: {
    title: "Retour de l\u2019emprunt",
    body: (
      <>
        Ici tu pourras bientôt créer ton <span className="font-semibold text-zinc-800">expédition retour</span>{" "}
        (étiquette, suivi). Le parcours est en cours de conception — merci de revenir un peu plus tard ou de contacter
        le support depuis l&apos;écran emprunt.
      </>
    ),
  },
  prolonger: {
    title: "Prolonger la location",
    body: (
      <>
        Bientôt tu pourras <span className="font-semibold text-zinc-800">prolonger ta période</span> depuis
        l&apos;app. Fonctionnalité en cours de conception — repasse plus tard ou contacte le support depuis
        l&apos;écran emprunt.
      </>
    ),
  },
};

export function CommandeRetourPlaceholderView({
  cartId,
  orderNumberCompact,
  variant = "retour",
}: CommandeRetourPlaceholderViewProps) {
  const copy = VARIANT_COPY[variant];
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white pb-[max(5rem,env(safe-area-inset-bottom,0px)+4.5rem)]">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <Link
            href={`/exchange/emprunt/${cartId}`}
            className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900 transition hover:bg-zinc-100"
            aria-label="Fermer"
          >
            <X className="h-8 w-8" strokeWidth={2.25} />
          </Link>
          <h1 className={cn("mt-5 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {copy.title}
          </h1>
          <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">Commande {orderNumberCompact}</p>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 px-5 pb-8 pt-6">
        <p className="text-[15px] leading-relaxed text-zinc-600">{copy.body}</p>
      </div>
    </main>
  );
}
