import { NextResponse } from "next/server";

import { openMemberCartDispute } from "@/lib/disputes/open-member-cart-dispute";
import type { MemberCartDisputeReportKind } from "@/lib/disputes/member-cart-dispute-categories";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { user, error: userError, supabase } = (await resolveRequestUserClient(request)) as any;
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const userId = user.id as string;
  const userEmail = typeof user.email === "string" ? user.email.trim() || null : null;
  const admin = createSupabaseAdminClient();

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const cartId = String(formData.get("cartId") ?? "").trim();
    const reportKindRaw = String(formData.get("reportKind") ?? "borrow").trim();
    const reportKind: MemberCartDisputeReportKind =
      reportKindRaw === "reception" ? "reception" : "borrow";
    const category = String(formData.get("category") ?? "").trim();
    const scope = String(formData.get("scope") ?? "").trim();
    const details = String(formData.get("details") ?? "").trim();
    const itemIdsRaw = String(formData.get("itemIds") ?? "[]");
    let itemIds: string[] = [];
    try {
      const parsed = JSON.parse(itemIdsRaw) as unknown;
      if (Array.isArray(parsed)) {
        itemIds = parsed.filter((v): v is string => typeof v === "string" && CART_ID_RE.test(v));
      }
    } catch {
      itemIds = [];
    }

    const photoFiles = formData
      .getAll("photos")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (!CART_ID_RE.test(cartId)) {
      return NextResponse.json({ error: "Identifiant de commande invalide" }, { status: 400 });
    }

    const chatSourceRaw = String(formData.get("chatSource") ?? "web").trim();
    const chatSource = chatSourceRaw === "app" ? "app" : "web";

    const result = await openMemberCartDispute(supabase, admin, {
      cartId,
      userId,
      userEmail,
      reportKind,
      category,
      scope: scope as "whole_cart" | "selected_items",
      details,
      itemIds,
      photoFiles,
      chatSource,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      disputeId: result.disputeId,
      updated: result.updated,
      conversationId: result.conversationId,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const cartId = typeof (body as { cartId?: unknown })?.cartId === "string" ? (body as { cartId: string }).cartId : "";
  const detailsRaw = typeof (body as { details?: unknown })?.details === "string" ? (body as { details: string }).details : "";
  const category = typeof (body as { category?: unknown })?.category === "string" ? (body as { category: string }).category : "other";
  const scope =
    (body as { scope?: unknown })?.scope === "selected_items" ? "selected_items" : "whole_cart";
  const itemIds = Array.isArray((body as { itemIds?: unknown }).itemIds)
    ? ((body as { itemIds: unknown[] }).itemIds.filter((v) => typeof v === "string") as string[])
    : [];

  if (!CART_ID_RE.test(cartId)) {
    return NextResponse.json({ error: "Identifiant de commande invalide" }, { status: 400 });
  }

  const reportKindRaw =
    typeof (body as { reportKind?: unknown })?.reportKind === "string"
      ? (body as { reportKind: string }).reportKind
      : "borrow";
  const reportKind = reportKindRaw === "reception" ? "reception" : "borrow";

  const chatSourceRaw =
    typeof (body as { chatSource?: unknown })?.chatSource === "string"
      ? (body as { chatSource: string }).chatSource
      : "web";
  const chatSource = chatSourceRaw === "app" ? "app" : "web";

  const result = await openMemberCartDispute(supabase, admin, {
    cartId,
    userId,
    userEmail,
    reportKind,
    category: category || (reportKind === "reception" ? "reception_other" : "borrow_other"),
    scope,
    details: detailsRaw,
    itemIds,
    photoFiles: [],
    chatSource,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    disputeId: result.disputeId,
    updated: result.updated,
    conversationId: result.conversationId,
  });
}
