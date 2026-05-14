"use client";

import { buildReferralNativeSharePayload } from "./referralShareMessage";

/**
 * Partage natif ou repli WhatsApp.
 * Beaucoup d’apps (ex. WhatsApp) ne montrent que `url` si on passe `{ text, url }` — on met donc tout dans `text`
 * (message + lien) pour que le contexte Segna / l’offre arrive toujours avec le lien.
 */
export async function shareReferralInviteNative(referralCode: string | null): Promise<void> {
  if (typeof window === "undefined") return;
  const origin = window.location.origin;
  const { title, text, url } = buildReferralNativeSharePayload(referralCode, origin);
  /** Un seul bloc texte : certains OS / apps affichent `title` puis `text` et répètent l’accroche. */
  const combined = `${title}\n\n${text}\n\n${url}`.trim();
  const payload: ShareData = { text: combined };

  if (typeof navigator.share === "function") {
    try {
      const can = typeof navigator.canShare !== "function" ? true : navigator.canShare(payload);
      if (can) {
        await navigator.share(payload);
        return;
      }
      await navigator.share({ text: combined });
      return;
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") return;
    }
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(combined)}`, "_blank", "noopener,noreferrer");
}
