import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";

import { readLogisticsRefusalNote } from "@/lib/items/intake-metadata";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ItemLogisticsRefusalPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const itemId = String(rawId ?? "").trim();
  if (!itemId) {
    redirect("/exchange");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login");
  }

  const { data: row, error } = await supabase
    .from("items")
    .select("id,title,status, item_intake(listing_stage,fulfillment_stage,metadata)")
    .eq("id", itemId)
    .eq("owner_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !row) {
    redirect("/exchange");
  }

  const rawIntake = row.item_intake as unknown;
  const emb = Array.isArray(rawIntake) ? rawIntake[0] : rawIntake;
  const intake =
    emb && typeof emb === "object"
      ? {
          listing_stage: String((emb as { listing_stage?: string }).listing_stage ?? ""),
          fulfillment_stage:
            (emb as { fulfillment_stage?: string | null }).fulfillment_stage != null
              ? String((emb as { fulfillment_stage?: string | null }).fulfillment_stage)
              : null,
          metadata: "metadata" in (emb as object) ? (emb as { metadata?: unknown }).metadata : null,
        }
      : null;

  const isLogisticsRefused =
    intake?.listing_stage === "validated" && intake?.fulfillment_stage === "refused";
  const statusRefused = String(row.status ?? "").toLowerCase() === "refused";

  if (!isLogisticsRefused && !statusRefused) {
    redirect(`/items/${itemId}`);
  }

  const title = (row.title as string | null)?.trim() || "Ta pièce";
  const note = readLogisticsRefusalNote(intake?.metadata ?? null);

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="border-b border-zinc-200 bg-white px-4 py-5">
        <div className="mx-auto flex max-w-[430px] items-center gap-2">
          <Link
            href={`/items/${itemId}`}
            className="rounded-lg p-1 -ml-1 text-zinc-700"
            aria-label="Retour à la fiche"
          >
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <h1 className="text-base font-semibold text-zinc-900">Refus après contrôle</h1>
        </div>
      </header>

      <div className="mx-auto max-w-[430px] space-y-4 px-5 py-6">
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <div className="rounded-2xl border border-rose-200/90 bg-rose-50/70 p-4">
          <p className="text-sm leading-relaxed text-zinc-800">
            La vérification physique de ta pièce a conduit à un <strong>refus logistique</strong>. Elle n&apos;entre pas
            au catalogue Segna dans l&apos;état constaté. L&apos;équipe a enregistré une étape de retour côté suivi ; tu
            peux aussi avoir un échange avec le service client via ton espace litiges si besoin.
          </p>
          {note ? (
            <p className="mt-3 rounded-lg border border-rose-200/80 bg-white px-3 py-2 text-sm text-zinc-900">
              <span className="font-semibold text-rose-900">Commentaire Segna : </span>
              {note}
            </p>
          ) : (
            <p className="mt-3 text-xs text-zinc-600">Aucun détail complémentaire n&apos;a été saisi sur cette décision.</p>
          )}
        </div>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-600">
          <li>Ta pièce reste listée dans <strong>Prêts</strong> avec le statut « Refus contrôle ».</li>
          <li>Si un retour est ouvert, suis les instructions reçues par e-mail ou l&apos;app.</li>
          <li>Les frais de retour peuvent être à ta charge sauf erreur Segna avérée.</li>
        </ul>
      </div>
    </main>
  );
}
