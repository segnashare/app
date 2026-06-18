/** Bloque l’app membre (shop, catalogue…) sur desktop. Bypass dev : `NEXT_PUBLIC_SEGNA_ALLOW_DESKTOP=1`. */
export function isDesktopMobileGateEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SEGNA_ALLOW_DESKTOP?.trim() !== "1";
}

/** Lien affiché sur l’écran desktop (QR + texte), ex. https://app.segnashare.com */
export function resolveDesktopMobileGateAppUrl(): string {
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (app && /^https:\/\//i.test(app)) return app.replace(/\/+$/, "");
  return "https://app.segnashare.com";
}
