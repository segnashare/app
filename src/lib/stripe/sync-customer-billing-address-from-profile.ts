import type Stripe from "stripe";

import { parseFranceCoursierAddress } from "@/lib/coursier/addresses";

type AdminClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown }>;
      };
    };
  };
};

/**
 * Préremplit `customer.address` (+ shipping) depuis l’adresse profil
 * pour que Checkout facture sans ressaisie vide.
 */
export async function syncStripeCustomerBillingAddressFromProfile(params: {
  stripe: Stripe;
  admin: AdminClient;
  userId: string;
  stripeCustomerId: string;
}): Promise<void> {
  const { stripe, admin, userId, stripeCustomerId } = params;

  const [{ data: userRow }, { data: profileRow }] = await Promise.all([
    admin.from("users").select("first_name, last_name").eq("id", userId).maybeSingle(),
    admin
      .from("user_profiles")
      .select("display_name, city, profile_data")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const user = (userRow ?? {}) as { first_name?: string | null; last_name?: string | null };
  const profile = (profileRow ?? {}) as {
    display_name?: string | null;
    city?: string | null;
    profile_data?: Record<string, unknown> | null;
  };
  const profileData = (profile.profile_data ?? {}) as Record<string, unknown>;
  const location = (profileData.location ?? {}) as Record<string, unknown>;
  const label = typeof location.label === "string" ? location.label.trim() : "";
  if (!label) return;

  const cityHint =
    (typeof profile.city === "string" && profile.city.trim()) ||
    (typeof location.relative_city === "string" && location.relative_city.trim()) ||
    null;
  const parsed = parseFranceCoursierAddress(label, cityHint);
  if (!parsed.PostalCode || !parsed.Address) return;

  const nameFromUser = [user.first_name, user.last_name]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(" ");
  const name =
    nameFromUser ||
    (typeof profile.display_name === "string" ? profile.display_name.trim() : "") ||
    undefined;

  const address: Stripe.AddressParam = {
    line1: parsed.Address.slice(0, 200),
    city: (parsed.City || "France").slice(0, 100),
    postal_code: parsed.PostalCode.slice(0, 20),
    country: "FR",
  };

  await stripe.customers.update(stripeCustomerId, {
    ...(name ? { name } : {}),
    address,
    // Même adresse en shipping → Checkout peut l’utiliser comme base facturation.
    shipping: {
      ...(name ? { name } : { name: "Client Segna" }),
      address,
    },
  });
}
