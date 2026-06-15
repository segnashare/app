import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";

import { resolveOuttakeTransferIdForItem } from "@/lib/items/member-outtake-groups";
import { parseItemOuttakeSnapshot } from "@/lib/items/outtake-metadata";
import { buildOuttakeShippingPageHref } from "@/lib/items/outtake-shipping-metadata";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ItemRetourPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const itemId = String(rawId ?? "").trim();
  if (!itemId) redirect("/exchange");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: row } = await supabase
    .from("items")
    .select("id,title,status,owner_user_id,deleted_at,item_outtake(stage,metadata)")
    .eq("id", itemId)
    .eq("owner_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) redirect("/exchange");

  const status = String(row.status ?? "");
  const readyForReturn = status === "available";
  const outtake = parseItemOuttakeSnapshot(row.item_outtake as unknown);
  const outtakeStage = outtake && !outtake.deletedAt ? outtake.stage : "none";

  if (outtakeStage === "return_open" || outtakeStage === "in_transit") {
    let transferId: string | null = null;
    try {
      const admin = createSupabaseAdminClient();
      transferId = await resolveOuttakeTransferIdForItem(admin, itemId);
    } catch {
      transferId = null;
    }
    redirect(buildOuttakeShippingPageHref(transferId));
  }

  const alreadyRequested = Boolean(outtake && outtake.stage !== "none" && !outtake.deletedAt);
  const cancellableStages = new Set(["return_open"]);
  const canCancelReturn = Boolean(outtake && !outtake.deletedAt && cancellableStages.has(outtake.stage));

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="border-b border-zinc-200 bg-white px-4 py-5">
        <div className="mx-auto flex max-w-[430px] items-center gap-2">
          <Link href={`/items/${itemId}`} className="-ml-1 rounded-lg p-1 text-zinc-700" aria-label="Retour à la fiche">
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <h1 className="text-base font-semibold text-zinc-900">Retour de la pièce</h1>
        </div>
      </header>

      <div className="mx-auto max-w-[430px] space-y-4 px-5 py-6">
        <p className="text-sm font-medium text-zinc-900">{(row.title as string | null)?.trim() || "Ta pièce"}</p>
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
          <p className="text-sm leading-relaxed text-zinc-700">
            Cette page permet d’exiger un retour de ta pièce. Si elle est <strong>available</strong>, le retour est
            activé rapidement. Sinon, ta demande reste en attente tant que la pièce n’est pas revenue à un état prêt au
            retour.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-600">
            <li>État 1 (prioritaire) : prête au retour ({readyForReturn ? "oui" : "non"})</li>
            <li>État 2 : demande enregistrée, en attente du bon statut</li>
          </ul>
        </div>

        {alreadyRequested ? (
          <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm text-emerald-900">Demande de retour enregistrée. Tu seras redirigée vers l&apos;expédition dès que la pièce sera prête.</p>
            {canCancelReturn ? (
              <form action="/api/items/outtake/cancel" method="post" className="pt-1">
                <input type="hidden" name="item_id" value={itemId} />
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700"
                >
                  Annuler la demande de retour
                </button>
                <p className="mt-1 text-xs text-zinc-500">Disponible tant que le retour n&apos;a pas été expédié.</p>
              </form>
            ) : null}
          </div>
        ) : (
          <form action="/api/items/outtake/request" method="post" className="space-y-2 rounded-2xl border border-zinc-200 p-4">
            <input type="hidden" name="item_id" value={itemId} />
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#5E3023] px-4 text-sm font-semibold text-white"
            >
              Valider la demande de retour
            </button>
            <p className="text-xs text-zinc-500">
              Après validation, tu arrives sur la page d&apos;expédition retour pour choisir le point relais et générer ton bordereau.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
