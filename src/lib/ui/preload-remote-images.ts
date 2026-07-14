const DEFAULT_PRELOAD_TIMEOUT_MS = 12_000;

export type RemoteMediaPreload = { url: string; kind: "image" | "video" };

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

function preloadOneRemoteVideo(url: string): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => defer(resolve);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const done = () => {
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
      video.remove();
      finish();
    };
    video.addEventListener("loadeddata", done, { once: true });
    video.addEventListener("error", done, { once: true });
    video.src = url;
    video.load();
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

/** Précharge images et vidéos (hero accueil, etc.). */
export async function preloadRemoteMedia(
  items: RemoteMediaPreload[],
  options?: { timeoutMs?: number },
): Promise<void> {
  await preloadHeroMediaWarm(items, options);
}

/**
 * Précharge le hero et retourne des URLs prêtes (blob pour images = affichage instantané).
 * Les vidéos restent sur l’URL source (buffer navigateur via preload + élément video).
 */
export async function preloadHeroMediaWarm(
  items: RemoteMediaPreload[],
  options?: { timeoutMs?: number },
): Promise<Map<string, string>> {
  const warmed = new Map<string, string>();
  const unique = items.filter((item) => item.url.trim());
  if (unique.length === 0) return warmed;

  const timeoutMs = options?.timeoutMs ?? DEFAULT_PRELOAD_TIMEOUT_MS;

  const loadAll = async () => {
    await Promise.all(
      unique.map(async (item) => {
        const url = item.url.trim();
        if (item.kind === "video") {
          await preloadOneRemoteVideo(url);
          warmed.set(url, url);
          return;
        }
        try {
          const res = await fetch(url, {
            cache: "force-cache",
            priority: "high",
          });
          if (!res.ok) throw new Error("fetch failed");
          const blob = await res.blob();
          warmed.set(url, URL.createObjectURL(blob));
        } catch {
          await preloadOneRemoteImage(url);
          warmed.set(url, url);
        }
      }),
    );
  };

  await Promise.race([
    loadAll(),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    }),
  ]);

  return warmed;
}
