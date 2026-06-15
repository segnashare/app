const DEFAULT_PRELOAD_TIMEOUT_MS = 12_000;

/** Collecte récursive des `signed_url` dans un payload CMS. */
export function collectSignedUrlsFromCmsValue(value: unknown, out = new Set<string>()): Set<string> {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSignedUrlsFromCmsValue(entry, out));
    return out;
  }
  if (typeof value !== "object") return out;

  const record = value as Record<string, unknown>;
  if (typeof record.signed_url === "string" && record.signed_url.trim()) {
    out.add(record.signed_url.trim());
  }
  Object.values(record).forEach((entry) => collectSignedUrlsFromCmsValue(entry, out));
  return out;
}

export function appendHttpUrls(out: Set<string>, values: Array<string | null | undefined>): void {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) out.add(value.trim());
  }
}

function defer(callback: () => void) {
  queueMicrotask(callback);
}

function preloadOneRemoteImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => defer(resolve);
    const img = new Image();
    img.onload = () => {
      void (async () => {
        try {
          if (typeof img.decode === "function") await img.decode();
        } catch {
          /* ignore */
        }
        finish();
      })();
    };
    img.onerror = finish;
    img.src = url;
  });
}

/** Précharge des visuels distants (timeout pour ne pas bloquer indéfiniment). */
export async function preloadRemoteImages(
  urls: string[],
  options?: { timeoutMs?: number },
): Promise<void> {
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0) return;

  const timeoutMs = options?.timeoutMs ?? DEFAULT_PRELOAD_TIMEOUT_MS;
  await Promise.race([
    Promise.all(unique.map((url) => preloadOneRemoteImage(url))),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    }),
  ]);
}
