/**
 * `user_subscriptions.cancel_at_period_end` pour le membre connecté / ciblé.
 */
export async function resolveSubscriptionCancelAtPeriodEnd(
  supabase: unknown,
  userId: string,
): Promise<boolean> {
  const client = supabase as {
    from: (table: string) => any;
  };

  try {
    const { data, error } = await client
      .from("user_subscriptions")
      .select("cancel_at_period_end")
      .eq("user_id", userId)
      .eq("provider", "stripe")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return Boolean(data?.cancel_at_period_end);
  } catch {
    return false;
  }
}
