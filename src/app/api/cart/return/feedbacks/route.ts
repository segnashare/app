import { NextResponse } from "next/server";

import { fetchCartReturnFeedbackLines } from "@/lib/cart/fetch-cart-return-feedback-lines";
import { fetchMemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import {
  parseCartReturnFeedbackDrafts,
  submitCartReturnItemFeedbacks,
} from "@/lib/cart/submit-cart-return-item-feedbacks";
import type { CartReturnFeedbackDraft } from "@/lib/feedback/item-feedback-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PHOTO_FIELD_RE = /^photo_([0-9a-f-]{36})_(\d)$/i;

export async function GET(request: Request) {
  const cartId = new URL(request.url).searchParams.get("cart_id")?.trim() ?? "";
  if (!CART_ID_RE.test(cartId)) {
    return NextResponse.json({ ok: false as const, error: "cart_id invalide" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false as const, error: "Authentification requise" }, { status: 401 });
  }

  const userId = user.id as string;
  const membershipLabel = await resolveMembershipLabel(supabase, userId);
  const detail = await fetchMemberCartOrderDetail(
    supabase,
    userId,
    cartId,
    walletCreditKindForMembership(membershipLabel),
  );
  if (!detail) {
    return NextResponse.json({ ok: false as const, error: "Commande introuvable" }, { status: 404 });
  }

  const state = await fetchCartReturnFeedbackLines(supabase, userId, detail);
  return NextResponse.json({ ok: true as const, cartId, ...state });
}

async function parseFeedbackFormData(formData: FormData): Promise<{ cartId: string; drafts: CartReturnFeedbackDraft[] } | null> {
  const cartId = String(formData.get("cart_id") ?? "").trim();
  const itemsRaw = String(formData.get("items") ?? "");
  if (!CART_ID_RE.test(cartId) || !itemsRaw) return null;

  let itemsJson: unknown;
  try {
    itemsJson = JSON.parse(itemsRaw);
  } catch {
    return null;
  }

  const drafts = parseCartReturnFeedbackDrafts(itemsJson);
  if (!drafts) return null;

  const filesByCartItem = new Map<string, File[]>();
  for (const [key, value] of formData.entries()) {
    const match = PHOTO_FIELD_RE.exec(key);
    if (!match || !(value instanceof File) || value.size <= 0) continue;
    const cartItemId = match[1];
    const slot = Number(match[2]);
    if (!Number.isFinite(slot) || slot < 0 || slot > 2) continue;
    const list = filesByCartItem.get(cartItemId) ?? [];
    list[slot] = value;
    filesByCartItem.set(cartItemId, list);
  }

  for (const draft of drafts) {
    const files = (filesByCartItem.get(draft.cartItemId) ?? []).filter((f): f is File => f instanceof File);
    draft.wornPhotoFiles = files;
  }

  return { cartId, drafts };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let cartId = "";
  let drafts: CartReturnFeedbackDraft[] | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const parsed = await parseFeedbackFormData(formData);
    if (!parsed) {
      return NextResponse.json({ ok: false as const, error: "Données invalides" }, { status: 400 });
    }
    cartId = parsed.cartId;
    drafts = parsed.drafts;
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
    }
    const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    cartId = typeof o.cart_id === "string" ? o.cart_id.trim() : "";
    drafts = parseCartReturnFeedbackDrafts(o.items);
  }

  if (!CART_ID_RE.test(cartId) || !drafts) {
    return NextResponse.json({ ok: false as const, error: "Données invalides" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false as const, error: "Authentification requise" }, { status: 401 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Service indisponible" }, { status: 503 });
  }

  const result = await submitCartReturnItemFeedbacks(admin, user.id, cartId, drafts);
  if (!result.ok) {
    return NextResponse.json({ ok: false as const, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true as const,
    saved_count: result.savedCount,
    credits_granted: result.creditsGranted,
  });
}
