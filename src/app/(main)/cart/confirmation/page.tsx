import Link from "next/link";
import { redirect } from "next/navigation";

import { ContinueToPaymentLink } from "@/components/cart/ContinueToPaymentLink";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CartConfirmationPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col bg-zinc-100 px-5 pb-10 pt-[max(1.25rem,env(safe-area-inset-top,0px)+12px)]">
      <div className="rounded-2xl bg-white px-5 py-8 shadow-sm ring-1 ring-zinc-200/80">
        <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-zinc-900">Panier réservé</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">
          Ta demande de réservation a bien été enregistrée. Tu recevras les prochaines étapes par e-mail.
        </p>
        <ContinueToPaymentLink />
        <Link
          href="/exchange"
          className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-2xl border border-zinc-300 bg-white text-[15px] font-bold text-zinc-900"
        >
          Retour à l&apos;échange
        </Link>
        <Link href="/cart" className="mt-3 block text-center text-sm font-semibold text-zinc-900 underline underline-offset-2">
          Voir le panier
        </Link>
      </div>
    </main>
  );
}
