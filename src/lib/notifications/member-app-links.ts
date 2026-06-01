import { resolvePublicOriginForEmailImages } from "@/lib/notifications/email-html";

/** Origine publique app membre (https), ex. https://app.segnashare.com */
export function resolveMemberAppPublicOrigin(): string {
  return resolvePublicOriginForEmailImages() ?? "https://app.segnashare.com";
}

export function memberAppHomeUrl(): string {
  return `${resolveMemberAppPublicOrigin()}/`;
}

export function memberAppExchangeUrl(): string {
  return `${resolveMemberAppPublicOrigin()}/exchange`;
}

export function memberAppShopUrl(): string {
  return `${resolveMemberAppPublicOrigin()}/shop`;
}

const SMS_MAX_LEN = 320;

/** Ajoute un lien https en fin de SMS en respectant la limite Twilio (320 car.). */
export function appendSmsAppLink(message: string, url: string, maxLen: number = SMS_MAX_LEN): string {
  const base = message.trim();
  const link = url.trim();
  if (!link) return base.slice(0, maxLen);
  const sep = base.endsWith(".") || base.endsWith("!") || base.endsWith("?") ? " " : " — ";
  const combined = `${base}${sep}${link}`;
  if (combined.length <= maxLen) return combined;
  const budget = maxLen - sep.length - link.length;
  if (budget < 8) return link.slice(0, maxLen);
  return `${base.slice(0, budget).trim()}${sep}${link}`;
}
