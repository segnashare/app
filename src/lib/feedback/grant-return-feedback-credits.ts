import type { SupabaseClient } from "@supabase/supabase-js";

export const RETURN_FEEDBACK_CREDIT_PER_ELEMENT = 5;

export type ReturnFeedbackCreditElement = "rating" | "comment" | "photo";

export type GrantReturnFeedbackCreditsResult = {
  totalGranted: number;
  grantedByElement: Record<ReturnFeedbackCreditElement, boolean>;
};

function idempotencyKey(userId: string, cartItemId: string, element: ReturnFeedbackCreditElement): string {
  return `feedback_return:${element}:${cartItemId}:${userId}`;
}

export async function grantReturnFeedbackCredits(
  admin: SupabaseClient,
  userId: string,
  cartId: string,
  cartItemId: string,
  itemId: string,
  elements: ReturnFeedbackCreditElement[],
): Promise<GrantReturnFeedbackCreditsResult> {
  const grantedByElement: Record<ReturnFeedbackCreditElement, boolean> = {
    rating: false,
    comment: false,
    photo: false,
  };
  let totalGranted = 0;

  for (const element of elements) {
    const key = idempotencyKey(userId, cartItemId, element);
    const amount = RETURN_FEEDBACK_CREDIT_PER_ELEMENT;

    const { error: insertErr } = await admin.from("wallet_transactions").insert({
      user_id: userId,
      kind: "credit",
      direction: "credit",
      amount_points: amount,
      status: "posted",
      idempotency_key: key,
      credit_bucket: "consumption",
      metadata: {
        source: "feedback_return",
        element,
        cart_id: cartId,
        cart_item_id: cartItemId,
        item_id: itemId,
        credits_kind: "consumption",
      },
    });

    if (insertErr) {
      const code = String((insertErr as { code?: string }).code ?? "");
      const duplicate =
        code === "23505" || insertErr.message?.toLowerCase().includes("duplicate") === true;
      if (duplicate) continue;
      continue;
    }

    const { data: walletRow } = await admin
      .from("user_wallets")
      .select("id,balance_consumption_points")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (walletRow?.id) {
      const current = Math.max(0, Math.floor(Number(walletRow.balance_consumption_points ?? 0)));
      await admin
        .from("user_wallets")
        .update({
          balance_consumption_points: current + amount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", walletRow.id);
    } else {
      await admin.from("user_wallets").insert({
        user_id: userId,
        balance_consumption_points: amount,
        balance_exchange_points: 0,
      });
    }

    grantedByElement[element] = true;
    totalGranted += amount;
  }

  return { totalGranted, grantedByElement };
}

export function completedFeedbackCreditElements(input: {
  rating: number;
  comment: string;
  wornPhotoCount: number;
}): ReturnFeedbackCreditElement[] {
  const elements: ReturnFeedbackCreditElement[] = [];
  if (input.rating >= 1 && input.rating <= 5) elements.push("rating");
  if (input.comment.trim().length > 5) elements.push("comment");
  if (input.wornPhotoCount >= 1) elements.push("photo");
  return elements;
}
