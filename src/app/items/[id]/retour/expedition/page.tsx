import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";

import { ReturnExpeditionClient } from "@/components/returns/ReturnExpeditionClient";
import { parseItemOuttakeSnapshot } from "@/lib/items/outtake-metadata";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ItemRetourExpeditionPage({ params }: PageProps) {
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
  const outtake = parseItemOuttakeSnapshot(row.item_outtake as unknown);
  const outMeta = outtake?.metadata ?? {};
  const existingLabelUrl = typeof outMeta.return_label_url === "string" ? outMeta.return_label_url : null;
  const existingTracking = typeof outMeta.return_tracking_number === "string" ? outMeta.return_tracking_number : null;
  const canShipNow = status === "retired" || status === "available";
  const canCancelReturn = Boolean(outtake && !outtake.deletedAt && outtake.stage === "return_open");

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="border-b border-zinc-200 bg-white px-4 py-5">
        <div className="mx-auto flex max-w-[430px] items-center gap-2">
          <Link href={`/items/${itemId}/retour`} className="-ml-1 rounded-lg p-1 text-zinc-700" aria-label="Retour">
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <h1 className="text-base font-semibold text-zinc-900">Retour — expédition</h1>
        </div>
      </header>
      <div className="mx-auto max-w-[430px] space-y-4 px-5 py-6">
        <p className="text-sm text-zinc-700">
          Choisis un point relais (ou domicile plus tard), confirme l’expédition et génère ton bordereau retour.
        </p>
        <ReturnExpeditionClient
          itemId={itemId}
          canShipNow={canShipNow}
          existingLabelUrl={existingLabelUrl}
          existingTracking={existingTracking}
        />
        {canCancelReturn ? (
          <form action="/api/items/outtake/cancel" method="post" className="rounded-2xl border border-zinc-200 bg-white p-4">
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
    </main>
  );
}
