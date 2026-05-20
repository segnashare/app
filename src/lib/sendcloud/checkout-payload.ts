/** Sérialisation choix Dynamic Checkout dans metadata panier / Stripe. */

export type SendcloudCheckoutPayload = {
  v: 1;
  opt: string;
  carrier: string;
  method: string;
  optionId: string;
  sp?: number;
  post?: string;
};

const PREFIX = "scdc:";

export function encodeSendcloudCheckoutPayload(payload: SendcloudCheckoutPayload): string {
  return PREFIX + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeSendcloudCheckoutPayload(raw: string): SendcloudCheckoutPayload | null {
  const t = raw.trim();
  if (!t.startsWith(PREFIX)) return null;
  try {
    const json = Buffer.from(t.slice(PREFIX.length), "base64url").toString("utf8");
    const o = JSON.parse(json) as SendcloudCheckoutPayload;
    if (o?.v !== 1 || typeof o.opt !== "string" || !o.opt.trim()) return null;
    return o;
  } catch {
    return null;
  }
}
