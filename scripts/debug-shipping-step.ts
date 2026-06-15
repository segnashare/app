import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

import { fetchIntakeGroupsForShipping } from "../src/lib/items/member-intake-groups";
import { INTAKE_GROUP_MAX_ITEMS } from "../src/lib/items/member-intake-groups.shared";
import {
  intakeEligibleForPiggybackLink,
  INTAKE_FULFILLMENT_READY,
} from "../src/lib/items/intake-fulfillment-stages";

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function isIntakeCartReturnPiggybackActive(metadata: unknown): boolean {
  if (!isPlainRecord(metadata)) return false;
  const sc = metadata.sendcloud;
  if (!isPlainRecord(sc)) return false;
  const mode = typeof sc.sc_shipping_mode === "string" ? sc.sc_shipping_mode.trim() : "";
  if (mode !== "cart_return_piggyback") return false;
  const cartId = typeof sc.sc_piggyback_cart_id === "string" ? sc.sc_piggyback_cart_id.trim() : "";
  const confirmedAt =
    typeof sc.sc_piggyback_confirmed_at === "string" ? sc.sc_piggyback_confirmed_at.trim() : "";
  return Boolean(cartId && confirmedAt);
}

function intakeRowEligibleForAutoGroup(intake: {
  listing_stage?: string;
  fulfillment_stage?: string | null;
  metadata?: unknown;
}): boolean {
  const ls = String(intake.listing_stage ?? "").toLowerCase();
  const fs = String(intake.fulfillment_stage ?? "").toLowerCase();
  if (ls !== "validated") return false;
  if (!intakeEligibleForPiggybackLink(fs) && fs !== INTAKE_FULFILLMENT_READY) return false;
  if (isIntakeCartReturnPiggybackActive(intake.metadata)) return false;
  return true;
}

async function findActiveTransferIdForItem(admin: ReturnType<typeof createClient>, itemId: string) {
  const { data: link } = await admin
    .from("transfer_items")
    .select("transfer_id")
    .eq("item_id", itemId.trim())
    .is("deleted_at", null)
    .maybeSingle();
  const transferId = link?.transfer_id ? String(link.transfer_id) : null;
  if (!transferId) return null;
  const { data: transfer } = await admin
    .from("transfers")
    .select("id")
    .eq("id", transferId)
    .is("deleted_at", null)
    .is("completed_at", null)
    .maybeSingle();
  return transfer?.id ? transferId : null;
}

async function main() {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });
  const userId = "03725fcf-f408-4b65-8004-670e62a884ef";

  const { data: rows } = await admin
    .from("items")
    .select("id, title, item_intake(listing_stage, fulfillment_stage, metadata)")
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  const eligible: { id: string; title: string; transferId: string | null }[] = [];
  for (const row of rows ?? []) {
    const id = String(row.id);
    const emb = (row as { item_intake?: unknown }).item_intake;
    const intake = Array.isArray(emb) ? emb[0] : emb;
    if (!intake || typeof intake !== "object") continue;
    const ls = String((intake as { listing_stage?: string }).listing_stage ?? "").toLowerCase();
    const fs = String((intake as { fulfillment_stage?: string }).fulfillment_stage ?? "").toLowerCase();
    if (!intakeRowEligibleForAutoGroup(intake as Parameters<typeof intakeRowEligibleForAutoGroup>[0])) {
      continue;
    }
    const transferId = await findActiveTransferIdForItem(admin, id);
    const { data: rawLink } = await admin
      .from("transfer_items")
      .select("transfer_id, transfers(completed_at, deleted_at)")
      .eq("item_id", id)
      .is("deleted_at", null)
      .maybeSingle();
    eligible.push({
      id,
      title: String(row.title ?? id),
      transferId,
      rawTransferId: rawLink?.transfer_id ? String(rawLink.transfer_id) : null,
      transferState: rawLink?.transfers ?? null,
    });
  }

  console.log("eligible", eligible);
  const unassigned = eligible.filter((e) => !e.transferId);
  console.log("unassigned", unassigned);

  const groups = await fetchIntakeGroupsForShipping(admin, userId);
  console.log(
    "open transfers capacity",
    groups.map((g) => ({ id: g.id, n: g.items.length, room: INTAKE_GROUP_MAX_ITEMS - g.items.length })),
  );
}

main().catch(console.error);
