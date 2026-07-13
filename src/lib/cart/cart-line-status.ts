export type CartLineStatus = "disponible" | "reserve" | "echec" | "en_attente_wallet";

export const CART_LINE_STATUS_CLASSNAMES: Record<CartLineStatus, string> = {
  disponible: "bg-emerald-100 text-emerald-700",
  reserve: "bg-zinc-100 text-zinc-700",
  echec: "bg-red-100 text-red-700",
  en_attente_wallet: "bg-slate-100 text-slate-700",
};
