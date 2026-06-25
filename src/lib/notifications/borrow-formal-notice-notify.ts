import type { SupabaseClient } from "@supabase/supabase-js";

import { formatBorrowReturnDueDateFr } from "@/lib/cart/cart-borrow-return-due";
import { borrowFormalNoticeSentEmail } from "@/lib/notifications/lifecycle-shipment-email";
import { sendMemberOutreachNotification } from "@/lib/notifications/member-outreach";
import {
  appendSmsAppLink,
  memberAppExchangeUrl,
} from "@/lib/notifications/member-app-links";
import { NotificationKind } from "@/lib/notifications/kinds";

/** E-mail + SMS complémentaires après envoi MED AR24. */
export async function notifyBorrowFormalNoticeSent(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    orderRef: string;
    lateDayIndex: number;
    deadlineAtIso: string;
    penaltiesAccruedCents: number;
    cronSmsNowMs?: number;
  },
): Promise<void> {
  const { data: user } = await admin.from("users").select("first_name").eq("id", input.userId).maybeSingle();
  const firstName = (user as { first_name?: string | null } | null)?.first_name ?? null;
  const deadlineLabel = formatBorrowReturnDueDateFr(new Date(input.deadlineAtIso).getTime());
  const empruntUrl = `${memberAppExchangeUrl()}/emprunt/${input.cartId}`;

  const { subject, text, html, smsBody } = borrowFormalNoticeSentEmail(firstName, {
    orderRef: input.orderRef,
    lateDayIndex: input.lateDayIndex,
    deadlineLabel,
    penaltiesAccruedCents: input.penaltiesAccruedCents,
    empruntUrl,
  });

  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.borrowFormalNoticeSent,
    idempotencyKey: `txn:borrow_formal_notice:${input.cartId}`,
    metadata: {
      cart_id: input.cartId,
      order_ref: input.orderRef,
      late_day_index: input.lateDayIndex,
      deadline_at: input.deadlineAtIso,
    },
    subject,
    text,
    html,
    channels: "email+phone",
    smsBody: appendSmsAppLink(smsBody, empruntUrl),
    applyCronSmsDailyCap: true,
    cronSmsNowMs: input.cronSmsNowMs,
  });
}
