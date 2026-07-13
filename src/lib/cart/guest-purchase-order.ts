import type { SupabaseClient } from "@supabase/supabase-js";

/** Commande Guest passée en mode achat (colonne panier ou facture Stripe liée). */
export async function isGuestPurchaseCartOrder(
  admin: SupabaseClient,
  cartId: string,
): Promise<boolean> {
  const [{ data: cartRow }, { data: invoiceRow }] = await Promise.all([
    admin.from("carts").select("checkout_purchase_mode").eq("id", cartId).maybeSingle(),
    admin
      .from("cart_order_stripe_invoices")
      .select("guest_purchase_stripe_invoice_id")
      .eq("cart_id", cartId)
      .maybeSingle(),
  ]);

  if ((cartRow as { checkout_purchase_mode?: boolean | null } | null)?.checkout_purchase_mode === true) {
    return true;
  }

  const invoiceId = (
    (invoiceRow as { guest_purchase_stripe_invoice_id?: string | null } | null)
      ?.guest_purchase_stripe_invoice_id ?? ""
  ).trim();
  return invoiceId.length > 0;
}
