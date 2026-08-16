import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

export type SubscriptionInvoiceDto = {
  id: string;
  number: string | null;
  status: string | null;
  amount_paid: number;
  currency: string;
  created: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  period_start: number | null;
  period_end: number | null;
};

/**
 * Factures d’abonnement Stripe + bornes de la période en cours.
 * Auth : cookies app ou `Authorization: Bearer` (mobile).
 */
export async function GET(request: Request) {
  const { user, error: userError } = await resolveRequestUser(request);

  if (userError || !user) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient() as any;

  const [{ data: billingRow }, { data: subRow }] = await Promise.all([
    admin
      .from("billing_customers")
      .select("provider_customer_id")
      .eq("user_id", user.id)
      .eq("provider", "stripe")
      .maybeSingle(),
    admin
      .from("user_subscriptions")
      .select("plan_code, status, current_period_start, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .eq("provider", "stripe")
      .maybeSingle(),
  ]);

  const customerId =
    typeof billingRow?.provider_customer_id === "string" ? billingRow.provider_customer_id.trim() : "";
  if (!customerId) {
    return NextResponse.json({
      ok: true as const,
      invoices: [] as SubscriptionInvoiceDto[],
      subscription: null,
    });
  }

  const { secretKey } = getStripeConfig();
  const stripe = new Stripe(secretKey);

  const list = await stripe.invoices.list({
    customer: customerId,
    limit: 24,
    status: "paid",
  });

  const invoices: SubscriptionInvoiceDto[] = list.data.map((inv) => ({
    id: inv.id,
    number: inv.number ?? null,
    status: inv.status ?? null,
    amount_paid: inv.amount_paid,
    currency: inv.currency,
    created: inv.created,
    hosted_invoice_url: inv.hosted_invoice_url ?? null,
    invoice_pdf: inv.invoice_pdf ?? null,
    period_start: inv.period_start ?? null,
    period_end: inv.period_end ?? null,
  }));

  return NextResponse.json({
    ok: true as const,
    invoices,
    subscription: subRow
      ? {
          plan_code: subRow.plan_code,
          status: subRow.status,
          current_period_start: subRow.current_period_start,
          current_period_end: subRow.current_period_end,
          cancel_at_period_end: Boolean(subRow.cancel_at_period_end),
        }
      : null,
  });
}
