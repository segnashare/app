/** Déclare le compte vers Discord / n8n (idempotent, fire-and-forget). */
export function declareUserRegisteredFromBrowser(source: string): void {
  try {
    void fetch("/api/ops/user-registered", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ source }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}
