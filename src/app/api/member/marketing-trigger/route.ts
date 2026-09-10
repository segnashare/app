import { NextResponse } from "next/server";

import { emitMarketingTriggerWithAdmin } from "@/lib/notifications/emit-marketing-trigger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_CLIENT_TRIGGERS = new Set([
  "cart_item_added",
  "cart_checkout_started",
  "shop_viewed",
  "item_draft_started",
  "item_submitted",
  "user_signed_up",
  "onboarding_signup_step_reached",
  "onboarding_completed",
  "phone_verified",
  "subscription_checkout_started",
  "order_returned",
]);

/**
 * Déclenche une règle marketing BO depuis un event client (auth membre requis).
 * Les envois réels dépendent des règles enabled + audience + opt-out.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const triggerEvent = typeof b.triggerEvent === "string" ? b.triggerEvent.trim() : "";
  if (!triggerEvent || !ALLOWED_CLIENT_TRIGGERS.has(triggerEvent)) {
    return NextResponse.json({ error: "Trigger non autorisé." }, { status: 400 });
  }

  const varsRaw = b.vars && typeof b.vars === "object" && !Array.isArray(b.vars) ? (b.vars as Record<string, unknown>) : {};
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(varsRaw)) {
    if (typeof v === "string") vars[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) vars[k] = String(v);
  }

  const contextRaw =
    b.context && typeof b.context === "object" && !Array.isArray(b.context)
      ? (b.context as Record<string, unknown>)
      : {};
  const str = (key: string) =>
    typeof contextRaw[key] === "string" ? (contextRaw[key] as string) : undefined;

  const idempotencySuffix =
    typeof b.idempotencySuffix === "string" && b.idempotencySuffix.trim()
      ? b.idempotencySuffix.trim().slice(0, 120)
      : `${Date.now()}`;

  // Fire-and-forget : ne bloque pas l’UX client.
  void emitMarketingTriggerWithAdmin({
    triggerEvent,
    userId: user.id,
    vars,
    idempotencySuffix: `${user.id}:${idempotencySuffix}`,
    context: {
      itemId: str("itemId"),
      itemLabel: str("itemLabel"),
      cartId: str("cartId"),
      orderId: str("orderId"),
      marqueItem: str("marqueItem"),
      etape: str("etape"),
      nbPieces: str("nbPieces"),
    },
  });

  return NextResponse.json({ ok: true as const });
}
