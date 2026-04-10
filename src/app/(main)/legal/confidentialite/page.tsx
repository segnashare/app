import Link from "next/link";

export default function ConfidentialitePage() {
  return (
    <main className="mx-auto max-w-[430px] px-5 py-8">
      <h1 className="text-2xl font-bold text-zinc-900">Politique de confidentialité</h1>
      <p className="mt-4 text-sm text-zinc-600">Contenu à venir.</p>
      <Link href="/cart/payment" className="mt-8 inline-block text-sm font-semibold text-zinc-900 underline underline-offset-2">
        Retour
      </Link>
    </main>
  );
}
