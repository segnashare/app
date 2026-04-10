import Link from "next/link";

const PDF_HREF = "/ressources/conditions-generales-location.pdf";

export default function ConditionsGeneralesLocationPage() {
  return (
    <main className="mx-auto max-w-[430px] px-5 py-8 pb-16">
      <h1 className="text-2xl font-bold text-zinc-900">Conditions générales de location</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-zinc-600">
        Document contractuel applicable à la location de pièces via Segna. Tu peux le consulter ou le télécharger au
        format PDF.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <a
          href={PDF_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900"
        >
          Ouvrir le PDF
        </a>
        <a
          href={PDF_HREF}
          download
          className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-zinc-300 text-[15px] font-semibold text-zinc-900 transition hover:bg-zinc-50"
        >
          Télécharger le PDF
        </a>
      </div>
      <Link
        href="/cart/payment"
        className="mt-8 inline-block text-sm font-semibold text-zinc-900 underline underline-offset-2"
      >
        Retour au paiement
      </Link>
    </main>
  );
}
