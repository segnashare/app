import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

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

const { data: items } = await admin
  .from("items")
  .select("id, owner_user_id, title, item_intake(listing_stage, fulfillment_stage, metadata)")
  .in("id", [
    "f8defcbb-c234-427b-92fc-c127d24d451a",
    "431c3348-7065-48ab-bb0d-cb95cabf93ac",
    "5afecbb0-7c9a-4daf-b6c4-4f5f1a31fdcf",
  ]);

const userId = String(items?.[0]?.owner_user_id ?? "");
console.log("userId", userId);
console.log("items", JSON.stringify(items, null, 2));

const { data: transfers } = await admin
  .from("transfers")
  .select("id, completed_at, deleted_at, created_at")
  .eq("user_id", userId)
  .order("created_at");

console.log("transfers", transfers);

for (const t of transfers ?? []) {
  const { data: links } = await admin
    .from("transfer_items")
    .select("item_id, deleted_at, sort_order")
    .eq("transfer_id", t.id);
  const { data: ship } = await admin
    .from("shipments")
    .select("id, status, transfer_id, tracking_number, deleted_at")
    .eq("transfer_id", t.id)
    .eq("context", "member_intake");
  console.log("transfer", t.id, { links, ship });
}
