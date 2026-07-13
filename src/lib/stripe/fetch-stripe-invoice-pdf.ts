/** Télécharge le PDF facture Stripe (`invoice.invoice_pdf`). */
export async function fetchStripeInvoicePdfBuffer(invoicePdfUrl: string): Promise<Buffer | null> {
  const url = invoicePdfUrl.trim();
  if (!url) return null;

  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      console.error("[stripe-invoice-pdf] fetch failed", res.status, url);
      return null;
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream")) {
      console.error("[stripe-invoice-pdf] unexpected content-type", contentType, url);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 128) {
      console.error("[stripe-invoice-pdf] payload too small", buf.length, url);
      return null;
    }
    return buf;
  } catch (e) {
    console.error("[stripe-invoice-pdf] fetch error", url, e);
    return null;
  }
}
