/** Résolution du label d’abonnement (aligné sur la page panier). */

export type MembershipLabel = "Guest" | "Membre +" | "Membre X";

type MembershipQueryResult = {
  data: unknown;
  error: { message?: string } | null;
};

type MembershipQueryBuilder = {
  select: (columns: string) => MembershipQueryBuilder;
  eq: (column: string, value: string) => MembershipQueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => MembershipQueryBuilder;
  limit: (count: number) => MembershipQueryBuilder;
  maybeSingle: () => PromiseLike<MembershipQueryResult>;
  then: PromiseLike<MembershipQueryResult>["then"];
};

type MembershipSupabaseClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<MembershipQueryResult>;
  from: (table: string) => MembershipQueryBuilder;
};

function toMembershipLabelFromRoles(roles: string[]): MembershipLabel {
  const normalized = roles.map((role) => role.trim().toLowerCase());
  if (normalized.some((role) => role.includes("segna_x") || role.includes("membre_x") || role.includes("premium") || role.includes("member_x"))) {
    return "Membre X";
  }
  if (normalized.some((role) => role.includes("segna_plus") || role.includes("membre_plus") || role.includes("plus") || role.includes("member_plus"))) {
    return "Membre +";
  }
  return "Guest";
}

type MembershipState = {
  plan_code?: string | null;
  subscription_status?: string | null;
};

function toMembershipLabelFromBilling(state: MembershipState | null | undefined): MembershipLabel {
  const status = (state?.subscription_status ?? "").toLowerCase();
  const planCode = (state?.plan_code ?? "").toLowerCase();
  const isActive = status === "active" || status === "trialing";
  if (!isActive) return "Guest";
  if (planCode === "segna_x") return "Membre X";
  if (planCode === "segna_plus") return "Membre +";
  return "Guest";
}

export async function resolveMembershipLabel(supabase: unknown, userId: string): Promise<MembershipLabel> {
  const client = supabase as MembershipSupabaseClient;
  const [membershipStateRes, subscriptionRowRes, rolesRes] = await Promise.all([
    client.rpc("get_current_membership_state"),
    client
      .from("user_subscriptions")
      .select("plan_code,status")
      .eq("user_id", userId)
      .eq("provider", "stripe")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client.from("user_roles").select("role").eq("user_id", userId),
  ]);

  const roles: string[] = ((rolesRes.data as Array<{ role?: string | null }> | null) ?? [])
    .map((entry) => entry.role ?? "")
    .filter(Boolean);
  const membershipLabelFromRpc = toMembershipLabelFromBilling((membershipStateRes.data ?? null) as MembershipState | null);
  const subRow = subscriptionRowRes.data as { plan_code?: string | null; status?: string | null } | null;
  const membershipLabelFromSubscriptionTable =
    subscriptionRowRes.error == null && subRow
      ? toMembershipLabelFromBilling({
          plan_code: subRow.plan_code ?? null,
          subscription_status: subRow.status ?? null,
        })
      : ("Guest" as const);

  if (membershipLabelFromSubscriptionTable !== "Guest") return membershipLabelFromSubscriptionTable;
  if (membershipLabelFromRpc !== "Guest") return membershipLabelFromRpc;
  /** Ligne Stripe présente mais abonnement inactif : ne pas ré-qualifier via les rôles (abo annulé côté Stripe sans sync des rôles). */
  if (subscriptionRowRes.error == null && subRow != null) return "Guest";

  return toMembershipLabelFromRoles(roles);
}
