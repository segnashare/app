import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

import { ensureAutoIntakeGroupsForUser, fetchIntakeGroupsForShipping } from "../src/lib/items/member-intake-groups";

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

  const { data: links } = await admin
    .from("transfer_items")
    .select("item_id, transfer_id, deleted_at, transfers!inner(id, completed_at, deleted_at)")
    .is("deleted_at", null);
  console.log(
    "active transfer_items",
    JSON.stringify(
      (links ?? []).filter((l) => {
        const t = l.transfers as { completed_at?: string | null; deleted_at?: string | null };
        return !t?.completed_at && !t?.deleted_at;
      }),
      null,
      2,
    ),
  );

  const { data: allActiveLinks } = await admin
    .from("transfer_items")
    .select("item_id, transfer_id, transfers!inner(completed_at, deleted_at, user_id)")
    .is("deleted_at", null)
    .eq("transfers.user_id", userId);
  console.log("all active links for user", JSON.stringify(allActiveLinks, null, 2));

  const { data: rows } = await admin
    .from("items")
    .select("id, item_intake(listing_stage, fulfillment_stage, metadata)")
    .eq("owner_user_id", userId)
    .is("deleted_at", null);
  console.log("eligible items count", rows?.length);

  const res = await ensureAutoIntakeGroupsForUser(admin, userId);
  console.log("ensureAutoIntakeGroupsForUser", JSON.stringify(res, null, 2));

  const groups = await fetchIntakeGroupsForShipping(admin, userId);
  console.log("fetchIntakeGroupsForShipping count", groups.length);
  console.log(JSON.stringify(groups, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
