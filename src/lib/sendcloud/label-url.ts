import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelFetch } from "@/lib/sendcloud/client";
import {
  fetchSendcloudParcelV3,
  isSendcloudParcelCancelled,
  resolveParcelLabelUrl,
} from "@/lib/sendcloud/shipments";

type ParcelLabelUrls = {
  normal_printer?: string[];
  label_printer?: string;
};

const SENDCLOUD_PARCEL_STATUS_CANCELLED_V2 = 2000;

function basicAuthHeader(env: SendcloudEnv): string {
  return `Basic ${Buffer.from(`${env.publicKey}:${env.secretKey}`, "utf8").toString("base64")}`;
}

export function buildSendcloudV3ParcelLabelUrl(env: SendcloudEnv, parcelId: number): string {
  const base = env.panelBaseUrl.replace(/\/api\/v2\/?$/i, "/api/v3").replace(/\/$/, "");
  return `${base}/parcels/${parcelId}/documents/label`;
}

export function buildSendcloudNormalPrinterLabelUrl(env: SendcloudEnv, parcelId: number): string {
  const base = env.panelBaseUrl.replace(/\/$/, "");
  return `${base}/labels/normal_printer/${parcelId}?start_from=0`;
}

export async function probeSendcloudLabelPdfUrl(
  env: SendcloudEnv,
  labelUrl: string,
): Promise<boolean> {
  const url = labelUrl.trim();
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/pdf",
        Authorization: basicAuthHeader(env),
      },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 64 && buf.subarray(0, 5).toString("ascii") === "%PDF";
  } catch {
    return false;
  }
}

/**
 * Après annonce async (legacy) ou annonce en cours, l’URL PDF peut mettre 1–10 s à apparaître.
 */
export async function waitForSendcloudParcelLabel(
  env: SendcloudEnv,
  parcelId: number,
): Promise<{ ok: true; trackingNumber: string; labelUrl: string } | { ok: false; error: string }> {
  const fallbackV3 = buildSendcloudV3ParcelLabelUrl(env, parcelId);
  const fallbackV2 = buildSendcloudNormalPrinterLabelUrl(env, parcelId);

  for (let attempt = 0; attempt < 16; attempt++) {
    const parcelV3 = await fetchSendcloudParcelV3(env, parcelId);
    if (parcelV3) {
      if (isSendcloudParcelCancelled(parcelV3)) {
        return { ok: false, error: "Sendcloud : le colis a été annulé dans le panel." };
      }
      const v3Url = resolveParcelLabelUrl(env, parcelV3);
      if (v3Url && (await probeSendcloudLabelPdfUrl(env, v3Url))) {
        return {
          ok: true,
          trackingNumber: String(parcelV3.tracking_number ?? "").trim(),
          labelUrl: v3Url,
        };
      }
    }

    const parcelRes = await sendcloudPanelFetch<{
      parcel: {
        tracking_number?: string;
        label?: ParcelLabelUrls;
        status?: { id?: number; message?: string };
      };
    }>(env, `/parcels/${parcelId}`, { method: "GET" });

    if (parcelRes.ok) {
      const parcel = parcelRes.data.parcel;
      const statusId = Number(parcel.status?.id ?? 0);
      const statusMsg = String(parcel.status?.message ?? "").toLowerCase();
      if (statusId === SENDCLOUD_PARCEL_STATUS_CANCELLED_V2 || statusMsg.includes("cancel")) {
        return { ok: false, error: "Sendcloud : le colis a été annulé dans le panel." };
      }

      const labelUrl =
        parcel.label?.normal_printer?.[0]?.trim() ||
        (typeof parcel.label?.label_printer === "string" ? parcel.label.label_printer.trim() : "") ||
        "";

      if (labelUrl && (await probeSendcloudLabelPdfUrl(env, labelUrl))) {
        return {
          ok: true,
          trackingNumber: String(parcel.tracking_number ?? "").trim(),
          labelUrl,
        };
      }

      if (
        statusMsg.includes("announced") ||
        statusMsg.includes("ready") ||
        statusMsg.includes("label")
      ) {
        if (await probeSendcloudLabelPdfUrl(env, fallbackV2)) {
          return {
            ok: true,
            trackingNumber: String(parcel.tracking_number ?? "").trim(),
            labelUrl: fallbackV2,
          };
        }
      }
    }

    if (attempt < 15) {
      await new Promise((r) => setTimeout(r, attempt < 3 ? 800 : 1500));
    }
  }

  if (await probeSendcloudLabelPdfUrl(env, fallbackV3)) {
    return { ok: true, trackingNumber: "", labelUrl: fallbackV3 };
  }
  if (await probeSendcloudLabelPdfUrl(env, fallbackV2)) {
    return { ok: true, trackingNumber: "", labelUrl: fallbackV2 };
  }

  return {
    ok: false,
    error:
      "Sendcloud : colis créé mais l’étiquette PDF n’est pas encore disponible. Réessaie dans quelques secondes ou vérifie le panneau Sendcloud.",
  };
}
