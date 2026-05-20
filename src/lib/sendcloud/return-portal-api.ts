import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelFetch } from "@/lib/sendcloud/client";

const DEFAULT_BRAND_DOMAIN = "segna";

export function getReturnPortalBrandDomain(): string {
  return process.env.SENDCLOUD_RETURN_PORTAL_BRAND_DOMAIN?.trim() || DEFAULT_BRAND_DOMAIN;
}

export function getIntakeReturnPortalReasonId(): number {
  const raw = process.env.SENDCLOUD_RETURN_PORTAL_REASON_ID?.trim();
  const n = raw ? parseInt(raw, 10) : 8;
  return Number.isFinite(n) && n > 0 ? n : 8;
}

type OutgoingParcel = {
  id: number;
  postal_code?: string;
  order_number?: string;
  tracking_number?: string;
  address_divided?: { street?: string; house_number?: string };
  address_2?: string;
  city?: string;
  company_name?: string;
  country?: { iso_2?: string } | string;
  email?: string;
  name?: string;
  telephone?: string;
  house_number?: string;
  to_state?: string;
};

export async function fetchReturnPortalOutgoing(
  env: SendcloudEnv,
  params: { identifier: string; postalCode: string },
): Promise<
  | {
      ok: true;
      accessToken: string;
      parcel: OutgoingParcel;
      products: Array<{ id: string; name?: string; price?: number; quantity?: number }>;
    }
  | { ok: false; error: string }
> {
  const domain = getReturnPortalBrandDomain();
  const postal = params.postalCode.replace(/\D/g, "").slice(0, 5);
  const identifier = params.identifier.trim();
  if (!postal || postal.length !== 5 || !identifier) {
    return { ok: false, error: "Identifiant ou code postal manquant." };
  }

  const qs = new URLSearchParams({ postal_code: postal, identifier });
  const res = await sendcloudPanelFetch<{
    access_token?: string;
    data?: {
      parcel?: OutgoingParcel;
      products?: Array<{ id: string; name?: string; price?: number; quantity?: number }>;
    };
  }>(env, `/brand/${encodeURIComponent(domain)}/return-portal/outgoing?${qs}`, {
    method: "GET",
  });

  if (!res.ok) {
    return {
      ok: false,
      error:
        res.status === 404
          ? "Commande introuvable sur Sendcloud. Réinitialise et réessaie."
          : res.error,
    };
  }

  const accessToken = String(res.data.access_token ?? "").trim();
  const parcel = res.data.data?.parcel;
  const parcelId = parcel?.id;
  if (!accessToken || !parcel || typeof parcelId !== "number" || parcelId <= 0) {
    return { ok: false, error: "Sendcloud : colis aller introuvable pour ce retour." };
  }

  return {
    ok: true,
    accessToken,
    parcel,
    products: res.data.data?.products ?? [],
  };
}

export async function createReturnPortalIncoming(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; pollerUrl: string; returnId: number; incomingParcelIds: number[] }
  | { ok: false; error: string }
> {
  const domain = getReturnPortalBrandDomain();
  const res = await fetch(
    `https://panel.sendcloud.sc/api/v2/brand/${encodeURIComponent(domain)}/return-portal/incoming`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const err =
      data && typeof data === "object" && Array.isArray((data as { errors?: unknown }).errors)
        ? String(
            ((data as { errors: Array<{ detail?: string }> }).errors[0]?.detail ?? res.status),
          )
        : `Sendcloud HTTP ${res.status}`;
    return { ok: false, error: err.slice(0, 400) };
  }

  const o = data as {
    poller_url?: string;
    return?: number;
    incoming_parcels?: number[];
  };
  const pollerUrl = String(o.poller_url ?? "").trim();
  const returnId = typeof o.return === "number" ? o.return : 0;
  const incomingParcelIds = Array.isArray(o.incoming_parcels)
    ? o.incoming_parcels.filter((x): x is number => typeof x === "number")
    : [];

  if (!pollerUrl || returnId <= 0 || incomingParcelIds.length < 1) {
    return { ok: false, error: "Sendcloud : création du retour sans étiquette." };
  }

  return { ok: true, pollerUrl, returnId, incomingParcelIds };
}

export async function pollReturnPortalLabel(
  pollerUrl: string,
  accessToken: string,
  maxAttempts = 20,
): Promise<{ ok: true; labelUrl: string } | { ok: false; error: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(pollerUrl, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (res.status === 202) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) {
      return { ok: false, error: `Étiquette Sendcloud indisponible (${res.status}).` };
    }
    const data = (await res.json().catch(() => null)) as {
      label_url?: string;
      label_normal_printer?: string;
      documents?: Array<{ link?: string }>;
    } | null;
    const labelUrl =
      String(data?.label_url ?? "").trim() ||
      String(data?.label_normal_printer ?? "").trim() ||
      String(data?.documents?.[0]?.link ?? "").trim();
    if (labelUrl.startsWith("http")) {
      return { ok: true, labelUrl };
    }
    return { ok: false, error: "Étiquette absente dans la réponse Sendcloud." };
  }
  return { ok: false, error: "Délai dépassé en attendant l’étiquette Sendcloud." };
}

export function buildReturnPortalIncomingBody(input: {
  reasonId: number;
  outgoingParcel: OutgoingParcel;
  servicePointId: number;
  deliveryOption?: "drop_off_point" | "drop_off_labelless";
  products?: Array<{ id: string; name?: string; price?: number; quantity?: number }>;
}): Record<string, unknown> {
  const p = input.outgoingParcel;
  const country =
    typeof p.country === "object" && p.country?.iso_2
      ? p.country.iso_2
      : typeof p.country === "string"
        ? p.country
        : "FR";

  return {
    reason: input.reasonId,
    message: "",
    outgoing_parcel: p.id,
    service_point: { id: input.servicePointId },
    refund: { refund_type: { code: "money" }, message: "" },
    delivery_option: input.deliveryOption ?? "drop_off_point",
    products: (input.products ?? []).map((item) => ({
      product_id: item.id,
      quantity: item.quantity ?? 1,
      description: item.name ?? "Pièce",
      value: item.price ?? 0,
      return_reason: input.reasonId,
      return_message: null,
    })),
    incoming_parcel: {
      collo_count: 1,
      from_address_1: p.address_divided?.street ?? p.name ?? "",
      from_address_2: p.address_2 ?? "",
      from_city: p.city ?? "",
      from_company_name: p.company_name ?? "",
      from_country: country,
      from_email: p.email ?? "",
      from_house_number: p.house_number ?? p.address_divided?.house_number ?? "1",
      from_name: p.name ?? "",
      from_postal_code: p.postal_code ?? "",
      from_telephone: p.telephone ?? "",
      from_country_state: p.to_state ?? "",
    },
    selected_functionalities: { first_mile: ["dropoff", "pickup_dropoff"] },
  };
}
