import Link from "next/link";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { parseBorrowRecoveryAuthSuspendRow } from "@/lib/emprunt/borrow-recovery-auth-suspend";

export default async function BorrowRecoveryAuthSuspendedPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: userRow } = await supabase
    .from("users")
    .select(
      "borrow_recovery_suspended_at, borrow_recovery_suspend_cart_id, borrow_recovery_suspend_reason",
    )
    .eq("id", user.id)
    .maybeSingle();

  const suspend = parseBorrowRecoveryAuthSuspendRow(
    userRow as {
      borrow_recovery_suspended_at?: string | null;
      borrow_recovery_suspend_cart_id?: string | null;
      borrow_recovery_suspend_reason?: string | null;
    } | null,
  );

  if (!suspend) {
    return (
      <div className={cn(segnaMontserrat.className, "mx-auto max-w-md px-5 py-10 text-center")}>
        <p className="text-[15px] text-zinc-700">Ton accès est rétabli.</p>
        <Link href="/shop" className="mt-4 inline-block text-[14px] font-semibold text-zinc-900 underline">
          Retour à la boutique
        </Link>
      </div>
    );
  }

  const cartId = suspend.cartId;

  return (
    <div className={cn(segnaMontserrat.className, "mx-auto max-w-md px-5 py-10 text-center")}>
      <h1 className="text-[20px] font-bold text-zinc-900">Accès suspendu</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-zinc-700">
        Ton compte est temporairement suspendu en lien avec un dossier de retour d&apos;emprunt en cours.
        Régularise ta situation ou dépose ton colis pour retrouver l&apos;accès à Segna.
      </p>
      {suspend.reason ? (
        <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-[13px] text-zinc-600">
          {suspend.reason}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3">
        <Link
          href={`/exchange/emprunt/${cartId}/regulariser`}
          className="rounded-full bg-zinc-900 px-5 py-3 text-[15px] font-semibold text-white"
        >
          Régulariser les frais
        </Link>
        <Link
          href={`/exchange/retour/${cartId}`}
          className="rounded-full border border-zinc-300 px-5 py-3 text-[15px] font-semibold text-zinc-900"
        >
          Déposer mon retour
        </Link>
        <Link
          href={`/exchange/emprunt/${cartId}`}
          className="text-[14px] font-semibold text-zinc-600 underline"
        >
          Voir mon emprunt
        </Link>
      </div>
    </div>
  );
}
