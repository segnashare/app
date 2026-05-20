/** CP membre pour devis livraison checkout (Sendcloud ou barème interne). */
export function memberPostalCodeForCheckoutShipping(opts: {
  deliveryChannel: "relay" | "home";
  relayPostalCode?: string | null;
  deliveryAddress?: { label?: string; city?: string | null; relativeCity?: string | null } | null;
}): string {
  if (opts.deliveryChannel === "relay") {
    return (opts.relayPostalCode ?? "").replace(/\D/g, "").slice(0, 5);
  }
  const source = [opts.deliveryAddress?.label, opts.deliveryAddress?.city, opts.deliveryAddress?.relativeCity]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  return source.match(/\b\d{5}\b/)?.[0] ?? "";
}
