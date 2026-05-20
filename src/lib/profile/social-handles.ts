/** --- Instagram (pseudo public, sans API) --- */

export function normalizeInstagramHandleInput(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/^@+/, "");
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      const parts = u.pathname.split("/").filter(Boolean);
      const first = parts[0] ?? "";
      if (first === "p" || first === "reel" || first === "reels" || first === "stories") return "";
      return first.replace(/^@/, "").trim();
    }
  } catch {
    return "";
  }
  return s.replace(/^@/, "").trim();
}

export function isValidInstagramHandle(handle: string): boolean {
  if (!handle || handle.length > 30) return false;
  return /^[a-zA-Z0-9._]+$/.test(handle);
}

export function instagramWebProfileUrl(handle: string): string {
  const h = normalizeInstagramHandleInput(handle);
  return `https://www.instagram.com/${encodeURIComponent(h)}/`;
}

/** --- TikTok --- */

export function normalizeTiktokHandleInput(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/^@+/, "");
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      const host = u.hostname.replace(/^www\./, "");
      if (host.includes("tiktok.com")) {
        const parts = u.pathname.split("/").filter(Boolean);
        const atIdx = parts.findIndex((p) => p.startsWith("@"));
        if (atIdx >= 0) return parts[atIdx].replace(/^@/, "").trim();
        const userIdx = parts.indexOf("user");
        if (userIdx >= 0 && parts[userIdx + 1]) return parts[userIdx + 1].replace(/^@/, "").trim();
      }
    }
  } catch {
    return "";
  }
  return s.replace(/^@/, "").trim();
}

export function isValidTiktokHandle(handle: string): boolean {
  if (!handle || handle.length > 24) return false;
  return /^[a-zA-Z0-9._]+$/.test(handle);
}

export function tiktokWebProfileUrl(handle: string): string {
  const h = normalizeTiktokHandleInput(handle);
  return `https://www.tiktok.com/@${encodeURIComponent(h)}`;
}

/** --- Pinterest (nom d'utilisateur du profil) --- */

export function normalizePinterestHandleInput(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/^@+/, "");
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      if (u.hostname.replace(/^www\./, "").includes("pinterest.")) {
        const parts = u.pathname.split("/").filter(Boolean);
        const first = parts[0] ?? "";
        if (first === "pin" || first === "search" || first === "ideas") return "";
        return first.trim();
      }
    }
  } catch {
    return "";
  }
  return s.trim();
}

export function isValidPinterestHandle(handle: string): boolean {
  if (!handle || handle.length < 3 || handle.length > 30) return false;
  return /^[a-zA-Z0-9_]+$/.test(handle);
}

export function pinterestWebProfileUrl(handle: string): string {
  const h = normalizePinterestHandleInput(handle);
  return `https://www.pinterest.com/${encodeURIComponent(h)}/`;
}

/** --- Threads --- */

export function normalizeThreadsHandleInput(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/^@+/, "");
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      if (u.hostname.replace(/^www\./, "").includes("threads.net")) {
        const parts = u.pathname.split("/").filter(Boolean);
        const first = parts[0] ?? "";
        return first.replace(/^@/, "").trim();
      }
    }
  } catch {
    return "";
  }
  return s.replace(/^@/, "").trim();
}

export function isValidThreadsHandle(handle: string): boolean {
  if (!handle || handle.length > 30) return false;
  return /^[a-zA-Z0-9._]+$/.test(handle);
}

export function threadsWebProfileUrl(handle: string): string {
  const h = normalizeThreadsHandleInput(handle);
  return `https://www.threads.net/@${encodeURIComponent(h)}`;
}

export type SocialHandlesDraft = {
  instagram: string;
  tiktok: string;
  pinterest: string;
  threads: string;
};

export function readSocialHandlesFromProfileData(profileData: Record<string, unknown>): SocialHandlesDraft {
  return {
    instagram: normalizeInstagramHandleInput(String(profileData.instagram_username ?? "")),
    tiktok: normalizeTiktokHandleInput(String(profileData.tiktok_username ?? "")),
    pinterest: normalizePinterestHandleInput(String(profileData.pinterest_username ?? "")),
    threads: normalizeThreadsHandleInput(String(profileData.threads_username ?? "")),
  };
}

/** Résumé pour la ligne « Mes infos » (modifier le profil). Seul Instagram est public. */
export function formatReseauxSummary(profileData: Record<string, unknown>): string {
  const h = readSocialHandlesFromProfileData(profileData);
  if (h.instagram) return `IG @${h.instagram}`;
  return "Non renseigné";
}
