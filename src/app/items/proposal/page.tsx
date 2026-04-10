import Link from "next/link";

import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";

const montserrat = segnaMontserrat;
const playfair = segnaPlayfairDisplay;

export default function ItemProposalInfoPage() {
  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-[430px] bg-white pb-28 pt-6">
      <div className="px-4">
        <p
          className={`${montserrat.className} text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500`}
        >
          Avant de t&apos;abonner
        </p>
        <h1
          className={`${playfair.className} mt-2 text-left text-[26px] leading-snug text-zinc-900 sm:text-[28px]`}
        >
          Proposer une pièce à prêter
        </h1>
        <div className={`${montserrat.className} mt-4 space-y-3 text-left text-[14px] leading-relaxed text-zinc-600 sm:text-[15px]`}>
          <p>
            Tu peux déposer une annonce{" "}
            <span className="font-semibold text-zinc-800">sans abonnement prêteur</span> : notre équipe valide la pièce
            et te communique une proposition de prix comme pour les membres.
          </p>
          <p>
            Si l&apos;annonce est acceptée,{" "}
            <span className="font-semibold text-zinc-800">aucune expédition n&apos;est déclenchée</span> tant que tu
            n&apos;as pas souscrit : tu sais ainsi que ta pièce est éligible avant de t&apos;engager.
          </p>
          <p>
            Une fois abonnée·e, tu pourras lancer l&apos;envoi vers Segna depuis l&apos;onglet « Prêts » (bordereau
            d&apos;envoi), comme pour les autres pièces validées.
          </p>
        </div>
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/items/new?proposal=1&fresh=1"
            className={`${montserrat.className} flex h-12 w-full items-center justify-center rounded-full bg-[#5E3023] text-[15px] font-semibold text-white shadow-sm`}
          >
            Créer mon annonce
          </Link>
          <Link
            href="/exchange"
            className={`${montserrat.className} flex h-11 w-full items-center justify-center text-[14px] font-semibold text-zinc-500 underline-offset-4 hover:underline`}
          >
            Retour à l&apos;échange
          </Link>
        </div>
      </div>
    </main>
  );
}
