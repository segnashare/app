import Link from "next/link";

import { MainContent } from "@/components/layout/MainContent";

type ItemDetailsPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ItemDetailsPage({ params }: ItemDetailsPageProps) {
  const { id } = await params;

  return (
    <MainContent>
      <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h1 className="text-2xl font-bold text-zinc-900">Item</h1>
        <p className="text-sm text-zinc-600">Page détail pour la pièce `{id}`.</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/items/${id}/evaluation`}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-800"
          >
            Évaluer
          </Link>
          <Link href="/exchange" className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-800">
            Retour à l&apos;exchange
          </Link>
        </div>
      </section>
    </MainContent>
  );
}
