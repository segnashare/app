/**
 * Crée la conversation chatbot (+ n8n) pour un litige déjà ouvert sans conversation_id.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-dispute-item-chat.ts <disputeId>
 */
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { ensureDisputeItemChat } from "../src/lib/disputes/ensure-dispute-item-chat";
import type { MemberCartDisputeReportKind } from "../src/lib/disputes/member-cart-dispute-categories";

async function main() {
  const disputeId = process.argv[2]?.trim();
  if (!disputeId) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/backfill-dispute-item-chat.ts <disputeId>");
    process.exit(1);
  }

  const admin = createSupabaseAdminClient();
  const { data: dispute, error } = await admin
    .from("cart_disputes")
    .select(
      "id,cart_id,reason,category,details,photo_paths,conversation_id,opened_by_user_id,status",
    )
    .eq("id", disputeId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !dispute?.id) {
    console.error("Litige introuvable", error?.message);
    process.exit(1);
  }

  if (dispute.conversation_id) {
    console.log("Déjà lié à conversation", dispute.conversation_id);
    process.exit(0);
  }

  const { data: user } = await admin
    .from("users")
    .select("email")
    .eq("id", dispute.opened_by_user_id)
    .maybeSingle();

  const reason = String(dispute.reason ?? "");
  const category = String(dispute.category ?? "");
  const reportKind: MemberCartDisputeReportKind =
    reason === "member_reception_report" || category.startsWith("reception_")
      ? "reception"
      : "borrow";

  const photoPaths = Array.isArray(dispute.photo_paths)
    ? dispute.photo_paths.filter((p): p is string => typeof p === "string")
    : [];

  const conversationId = await ensureDisputeItemChat({
    admin,
    cartId: String(dispute.cart_id),
    disputeId: String(dispute.id),
    existingConversationId: null,
    userId: String(dispute.opened_by_user_id),
    userEmail: typeof user?.email === "string" ? user.email : null,
    reportKind,
    category: category || (reportKind === "reception" ? "reception_other" : "borrow_other"),
    details: typeof dispute.details === "string" ? dispute.details : "",
    photoUrls: [],
    updated: false,
    source: "app",
  });

  if (!conversationId) {
    console.error("Échec création conversation (voir logs ensure-dispute-item-chat)");
    process.exit(1);
  }

  console.log("OK conversationId=", conversationId, "disputeId=", disputeId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
