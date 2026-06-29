import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadUserContact(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from("users")
    .select("email, phone, first_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[notifications] loadUserContact", error.message);
    return null;
  }
  return data;
}
