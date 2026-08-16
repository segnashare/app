import type { SupabaseClient } from "@supabase/supabase-js";

import { borrowDueAtFromPeriodEnd } from "@/lib/subscription/borrow-due-from-period-end";

type OpenRentalCart = {
  id: string;
  borrow_return_due_at: string | null;
  checkout_borrow_duration_days: number | null;
  checkout_purchase_mode: boolean | null;
  member_receipt_confirmed_at?: string | null;
  status: string;
};

function isSegnaXUnlimitedStyleDuration(days: number | null): boolean {
  return days == null || days === 30;
}

function parisCalendarDaysBetween(startMs: number, endMs: number): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const a = fmt.format(new Date(startMs));
  const b = fmt.format(new Date(endMs));
  return Math.max(
    1,
    Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000),
  );
}

/**
 * Paniers location ouverts : la fin d’abonnement devient le dernier jour de location
 * (locations X « sans limite » → durée limitée ; échéance clampée / figée à la fin d’abo).
 */
export async function applySubscriptionCancelToOpenRentals(
  admin: SupabaseClient,
  userId: string,
  periodEndIso: string,
): Promise<{ updatedCartIds: string[] }> {
  const dueAt = borrowDueAtFromPeriodEnd(periodEndIso);
  const dueMs = Date.parse(dueAt);

  const { data, error } = await admin
    .from("carts")
    .select(
      "id, borrow_return_due_at, checkout_borrow_duration_days, checkout_purchase_mode, member_receipt_confirmed_at, status",
    )
    .eq("user_id", userId)
    .in("status", ["confirmed", "disputed"])
    .or("checkout_purchase_mode.is.null,checkout_purchase_mode.eq.false");

  if (error) {
    console.error("[subscription] applyCancelToOpenRentals", error.message);
    return { updatedCartIds: [] };
  }

  const rows = (data ?? []) as OpenRentalCart[];
  const updatedCartIds: string[] = [];

  for (const cart of rows) {
    if (cart.checkout_purchase_mode === true) continue;

    const existingDays =
      cart.checkout_borrow_duration_days != null &&
      Number.isFinite(Number(cart.checkout_borrow_duration_days)) &&
      Number(cart.checkout_borrow_duration_days) >= 1
        ? Math.trunc(Number(cart.checkout_borrow_duration_days))
        : null;
    const unlimitedStyle = isSegnaXUnlimitedStyleDuration(existingDays);

    const existingMs =
      typeof cart.borrow_return_due_at === "string" && cart.borrow_return_due_at.trim()
        ? Date.parse(cart.borrow_return_due_at)
        : Number.NaN;

    // Complément 7j/14j déjà plus court : ne pas prolonger jusqu’à la fin d’abo.
    // Idem si échéance déjà passée (retard / litige) : ne pas rallonger.
    if (!unlimitedStyle && Number.isFinite(existingMs) && existingMs <= dueMs) continue;
    if (Number.isFinite(existingMs) && existingMs < Date.now() && existingMs <= dueMs) continue;

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Locations X : figer l’échéance à la fin d’abonnement (dernier jour de location).
    if (unlimitedStyle || !Number.isFinite(existingMs) || existingMs > dueMs) {
      patch.borrow_return_due_at = dueAt;
    }

    if (unlimitedStyle) {
      const startMs = cart.member_receipt_confirmed_at
        ? Date.parse(cart.member_receipt_confirmed_at)
        : Date.now();
      const anchorMs = Number.isFinite(startMs) ? startMs : Date.now();
      patch.checkout_borrow_duration_days = parisCalendarDaysBetween(anchorMs, dueMs);
    } else if (existingDays == null) {
      patch.checkout_borrow_duration_days = parisCalendarDaysBetween(Date.now(), dueMs);
    }

    const { error: updErr } = await admin.from("carts").update(patch).eq("id", cart.id);
    if (updErr) {
      console.error("[subscription] cart due clamp failed", cart.id, updErr.message);
      continue;
    }
    updatedCartIds.push(cart.id);
  }

  return { updatedCartIds };
}
