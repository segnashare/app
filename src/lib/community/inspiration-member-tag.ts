import { normalizeInstagramHandleInput } from "@/lib/profile/social-handles";

/** Tag membre type feed looks : `@pseudo` IG si renseigné, sinon dérivé du display name. */
export function inspirationMemberTag(
  displayName: string,
  instagramUsername?: string | null,
): string {
  const ig = normalizeInstagramHandleInput(instagramUsername ?? "");
  if (ig) return `@${ig.toLowerCase()}`;

  const base = displayName.trim();
  if (!base || /^membre(\s+segna)?$/i.test(base)) return "@membre";

  const handle = base
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
  return `@${handle || "membre"}`;
}
