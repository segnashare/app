import type { SupabaseClient } from "@supabase/supabase-js";

import { borrowNonRestitutionInvoicedEmail } from "@/lib/notifications/lifecycle-shipment-email";
import { sendMemberOutreachNotification } from "@/lib/notifications/member-outreach";
import {
  appendSmsAppLink,
  memberAppExchangeUrl,
} from "@/lib/notifications/member-app-links";
import { NotificationKind } from "@/lib/notifications/kinds";

/** E-mail + SMS après émission facture Stripe non-restitution. */
export async function notifyBorrowNonRestitutionInvoiced(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    orderRef: string;
    cartValueCents: number;
    unpaidPenaltyCents: number;
    totalCents: number;
    hostedInvoiceUrl: string | null;
    cronSmsNowMs?: number;
  },
): Promise<void> {
  const { data: user } = await admin.from("users").select("first_name").eq("id", input.userId).maybeSingle();
  const firstName = (user as { first_name?: string | null } | null)?.first_name ?? null;
  const empruntUrl = `${memberAppExchangeUrl()}/emprunt/${input.cartId}`;

  const { subject, text, html, smsBody } = borrowNonRestitutionInvoicedEmail(firstName, {
    orderRef: input.orderRef,
    cartValueCents: input.cartValueCents,
    unpaidPenaltyCents: input.unpaidPenaltyCents,
    totalCents: input.totalCents,
    hostedInvoiceUrl: input.hostedInvoiceUrl,
    empruntUrl,
  });

  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.borrowNonRestitutionInvoiced,
    idempotencyKey: `txn:borrow_non_restitution_invoice:${input.cartId}`,
    metadata: {
      cart_id: input.cartId,
      order_ref: input.orderRef,
      total_cents: input.totalCents,
      hosted_invoice_url: input.hostedInvoiceUrl,
    },
    subject,
    text,
    html,
    channels: "email+phone",
    smsBody: appendSmsAppLink(smsBody, input.hostedInvoiceUrl ?? empruntUrl),
    applyCronSmsDailyCap: true,
    cronSmsNowMs: input.cronSmsNowMs,
  });
}
