/** Avatars staff locaux (override Discord / fallback). */
const STAFF_AVATARS: Record<string, string> = {
  guilhem: "/brand/staff/guilhem.jpg",
};

export function resolveStaffAvatarUrl(
  displayName: string | null | undefined,
  remoteUrl?: string | null,
): string | null {
  const key = String(displayName ?? "")
    .trim()
    .split(/\s+/)[0]
    ?.normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  if (key && STAFF_AVATARS[key]) return STAFF_AVATARS[key];
  const remote = typeof remoteUrl === "string" ? remoteUrl.trim() : "";
  return remote || null;
}
