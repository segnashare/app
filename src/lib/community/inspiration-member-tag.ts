import { instagramWebProfileUrl, normalizeInstagramHandleInput } from "@/lib/profile/social-handles";

export type StyleLookEntryKind = "look" | "inspi";

export function parseStyleLookEntryKind(raw: unknown): StyleLookEntryKind {
  return raw === "inspi" ? "inspi" : "look";
}

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

export type InspirationCredit = {
  kind: "member" | "segna" | "instagram" | "none";
  /** `@handle` seul. */
  label: string;
  href: string | null;
  external: boolean;
};

export function inspirationCredit(input: {
  entryKind?: StyleLookEntryKind | null;
  authorUserId?: string | null;
  displayName: string;
  instagramUsername?: string | null;
}): InspirationCredit {
  const ig = normalizeInstagramHandleInput(input.instagramUsername ?? "");
  const isInspi =
    input.entryKind === "inspi" ||
    (input.entryKind == null && !input.authorUserId && Boolean(ig) && input.displayName !== "Segna");

  if (isInspi) {
    if (!ig) return { kind: "none", label: "", href: null, external: false };
    const label = `@${ig.toLowerCase()}`;
    return {
      kind: "instagram",
      label,
      href: instagramWebProfileUrl(ig),
      external: true,
    };
  }

  if (input.authorUserId) {
    return {
      kind: "member",
      label: inspirationMemberTag(input.displayName, input.instagramUsername),
      href: `/membre/${input.authorUserId}`,
      external: false,
    };
  }

  return {
    kind: "segna",
    label: inspirationMemberTag(input.displayName || "Segna", null),
    href: null,
    external: false,
  };
}

