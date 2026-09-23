import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { isReturnExchangeFinishedForMemberList } from "@/lib/cart/cart-return-status";
import { resolveStripeCustomerPaymentMethod } from "@/lib/stripe/stripe-customer-payment-method";

/** Seuil : total des locations encore dehors (valeur pièces, 1 crédit = 1 €). */
export const RENTAL_DEPOSIT_THRESHOLD_CENTS = 50_000;
/** Montant de la préautorisation (non capturée). */
export const RENTAL_DEPOSIT_HOLD_AMOUNT_CENTS = 10_000;

export const RENTAL_DEPOSIT_HOLD_KIND = "rental_deposit_hold";

const OPEN_HOLD_STATUSES = ["requires_capture", "requires_action"] as const;

export type RentalDepositPreview = {
  required: boolean;
  hasOpenHold: boolean;
  activeValueCents: number;
  amountCents: number;
  thresholdCents: number;
};

type AdminClient = SupabaseClient;

function pricePointsToCents(points: unknown): number {
  return Math.max(0, Math.trunc(Number(points ?? 0))) * 100;
}

export function emptyRentalDepositPreview(): RentalDepositPreview {
  return {
    required: false,
    hasOpenHold: false,
    activeValueCents: 0,
    amountCents: RENTAL_DEPOSIT_HOLD_AMOUNT_CENTS,
    thresholdCents: RENTAL_DEPOSIT_THRESHOLD_CENTS,
  };
}

/**
 * Total des locations encore chez le membre + panier en cours de checkout.
 * Achat définitif : jamais de caution.
 */
export async function resolveRentalDepositPreview(
  admin: AdminClient,
  input: { userId: string; currentCartId?: string | null; purchaseMode?: boolean },
): Promise<RentalDepositPreview> {
  const base = emptyRentalDepositPreview();
  if (input.purchaseMode) return base;

  const { data: openHold } = await admin
    .from("member_rental_deposit_holds")
    .select("id")
    .eq("user_id", input.userId)
    .in("status", [...OPEN_HOLD_STATUSES])
    .limit(1)
    .maybeSingle();

  const hasOpenHold = Boolean((openHold as { id?: string } | null)?.id);

  const { data: cartRows, error: cartsError } = await admin
    .from("carts")
    .select("id,status,checkout_purchase_mode")
    .eq("user_id", input.userId)
    .is("deleted_at", null)
    .in("status", ["confirmed", "active", "checkout_pending"]);

  if (cartsError) {
    console.error("[rental-deposit] preview carts", cartsError.message);
    return { ...base, hasOpenHold };
  }

  const currentCartId = String(input.currentCartId ?? "").trim();
  const rentalCarts = ((cartRows ?? []) as {
    id?: string;
    status?: string;
    checkout_purchase_mode?: boolean | null;
  }[]).filter((row) => {
    const id = String(row.id ?? "").trim();
    if (!id) return false;
    if (row.checkout_purchase_mode === true) return false;
    if (id === currentCartId) return true;
    return row.status === "confirmed";
  });

  const cartIds = rentalCarts.map((row) => String(row.id));
  if (cartIds.length === 0) {
    return { ...base, hasOpenHold };
  }

  const { data: returnRows } = await admin
    .from("shipments")
    .select("cart_id,status,updated_at")
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .in("cart_id", cartIds);

  const latestReturnByCart = new Map<string, string>();
  for (const row of (returnRows ?? []) as {
    cart_id?: string;
    status?: string;
    updated_at?: string;
  }[]) {
    const cartId = String(row.cart_id ?? "").trim();
    if (!cartId) continue;
    const prev = latestReturnByCart.get(cartId);
    const updatedAt = String(row.updated_at ?? "");
    if (!prev || updatedAt > prev) {
      latestReturnByCart.set(cartId, `${updatedAt}\t${String(row.status ?? "")}`);
    }
  }

  const activeCartIds = rentalCarts
    .filter((row) => {
      const id = String(row.id);
      if (id === currentCartId) return true;
      const packed = latestReturnByCart.get(id);
      const status = packed?.split("\t")[1] ?? null;
      return !isReturnExchangeFinishedForMemberList(status);
    })
    .map((row) => String(row.id));

  if (activeCartIds.length === 0) {
    return { ...base, hasOpenHold };
  }

  const { data: itemRows, error: itemsError } = await admin
    .from("cart_items")
    .select("cart_id, items(price_points)")
    .in("cart_id", activeCartIds)
    .is("deleted_at", null);

  if (itemsError) {
    console.error("[rental-deposit] preview items", itemsError.message);
    return { ...base, hasOpenHold };
  }

  const activeValueCents = ((itemRows ?? []) as {
    items?: { price_points?: number | null } | { price_points?: number | null }[] | null;
  }[]).reduce((sum, row) => {
    const item = Array.isArray(row.items) ? row.items[0] : row.items;
    return sum + pricePointsToCents(item?.price_points);
  }, 0);

  return {
    required: !hasOpenHold && activeValueCents > RENTAL_DEPOSIT_THRESHOLD_CENTS,
    hasOpenHold,
    activeValueCents,
    amountCents: RENTAL_DEPOSIT_HOLD_AMOUNT_CENTS,
    thresholdCents: RENTAL_DEPOSIT_THRESHOLD_CENTS,
  };
}

function holdStatusFromPaymentIntent(status: Stripe.PaymentIntent.Status): string {
  if (status === "requires_capture") return "requires_capture";
  if (status === "requires_action" || status === "requires_confirmation") return "requires_action";
  if (status === "canceled") return "canceled";
  if (status === "succeeded") return "captured";
  return "failed";
}

async function persistDepositHoldRow(
  admin: AdminClient,
  input: {
    userId: string;
    cartId: string;
    paymentIntentId: string;
    status: string;
    activeValueCents: number;
  },
): Promise<void> {
  const { error } = await admin.from("member_rental_deposit_holds").upsert(
    {
      user_id: input.userId,
      origin_cart_id: input.cartId,
      stripe_payment_intent_id: input.paymentIntentId,
      amount_cents: RENTAL_DEPOSIT_HOLD_AMOUNT_CENTS,
      active_value_cents: input.activeValueCents,
      status: input.status,
    },
    { onConflict: "stripe_payment_intent_id" },
  );
  if (error) {
    console.error("[rental-deposit] persist hold", error.message);
  }
}

/**
 * Préautorisation 100 € après confirmation de commande (carte déjà enregistrée).
 * Idempotent : une seule caution ouverte par membre.
 */
export async function createRentalDepositHoldAfterCartConfirm(params: {
  stripe: Stripe;
  admin: AdminClient;
  userId: string;
  cartId: string;
  purchaseMode?: boolean;
}): Promise<{ paymentIntentId: string; status: string } | null> {
  const preview = await resolveRentalDepositPreview(params.admin, {
    userId: params.userId,
    currentCartId: params.cartId,
    purchaseMode: params.purchaseMode === true,
  });
  if (!preview.required) return null;

  const pm = await resolveStripeCustomerPaymentMethod(params.stripe, params.admin, params.userId);
  if (!pm.ok) {
    console.warn("[rental-deposit] no payment method", params.userId, pm.error);
    return null;
  }

  try {
    const paymentIntent = await params.stripe.paymentIntents.create(
      {
        amount: RENTAL_DEPOSIT_HOLD_AMOUNT_CENTS,
        currency: "eur",
        customer: pm.customerId,
        payment_method: pm.paymentMethodId,
        capture_method: "manual",
        confirm: true,
        off_session: true,
        description: "Caution location Segna — préautorisation 100 €",
        metadata: {
          user_id: params.userId,
          cart_id: params.cartId,
          kind: RENTAL_DEPOSIT_HOLD_KIND,
          active_value_cents: String(preview.activeValueCents),
        },
      },
      { idempotencyKey: `rental_deposit_hold:user:${params.userId}` },
    );

    const status = holdStatusFromPaymentIntent(paymentIntent.status);
    await persistDepositHoldRow(params.admin, {
      userId: params.userId,
      cartId: params.cartId,
      paymentIntentId: paymentIntent.id,
      status,
      activeValueCents: preview.activeValueCents,
    });

    if (status !== "requires_capture" && status !== "requires_action") {
      console.warn("[rental-deposit] unexpected PI status", paymentIntent.id, paymentIntent.status);
    }

    return { paymentIntentId: paymentIntent.id, status };
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code ?? "") : "";
    const errPi =
      e && typeof e === "object" && "payment_intent" in e
        ? (e as { payment_intent?: Stripe.PaymentIntent }).payment_intent
        : null;
    if (errPi && typeof errPi === "object" && typeof errPi.id === "string") {
      const status = holdStatusFromPaymentIntent(errPi.status);
      await persistDepositHoldRow(params.admin, {
        userId: params.userId,
        cartId: params.cartId,
        paymentIntentId: errPi.id,
        status: code === "authentication_required" ? "requires_action" : status,
        activeValueCents: preview.activeValueCents,
      });
      return { paymentIntentId: errPi.id, status };
    }
    console.error("[rental-deposit] create hold failed", params.userId, e);
    return null;
  }
}
