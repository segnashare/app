import type { IntakeGroupSnapshot } from "@/lib/items/member-intake-groups.shared";

type ShippingApiResponse = {
  ok?: boolean;
  groups?: IntakeGroupSnapshot[];
  error?: string;
};

export type ShippingPageLoadResult =
  | { status: "ok"; groups: IntakeGroupSnapshot[] }
  | { status: "reject"; error: string | null; empty: boolean };

const inflightByUrl = new Map<string, Promise<ShippingPageLoadResult>>();

function shippingApiUrl(mode: "intake" | "outtake"): string {
  return mode === "outtake" ? "/api/outtakes/shipping" : "/api/intakes/shipping";
}

function networkErrorMessage(mode: "intake" | "outtake"): string {
  return mode === "outtake" ? "Impossible de charger tes retours." : "Impossible de charger tes envois.";
}

/** Charge les groupes shipping (dédoublonné entre remontages React / Strict Mode). */
export async function fetchShippingPageGroups(
  mode: "intake" | "outtake",
  options?: { force?: boolean },
): Promise<ShippingPageLoadResult> {
  const url = shippingApiUrl(mode);
  if (!options?.force) {
    const existing = inflightByUrl.get(url);
    if (existing) return existing;
  }

  const promise = (async (): Promise<ShippingPageLoadResult> => {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const data = (await res.json().catch(() => ({}))) as ShippingApiResponse;
      if (!data.ok || !data.groups) {
        return { status: "reject", error: data.error ?? null, empty: false };
      }
      if (data.groups.length === 0) {
        return { status: "reject", error: null, empty: true };
      }
      return { status: "ok", groups: data.groups };
    } catch {
      return { status: "reject", error: networkErrorMessage(mode), empty: false };
    } finally {
      inflightByUrl.delete(url);
    }
  })();

  inflightByUrl.set(url, promise);
  return promise;
}
