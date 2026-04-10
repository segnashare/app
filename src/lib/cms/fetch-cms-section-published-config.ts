import { isSupabaseTransportFailure, warnCmsSupabaseUnreachable } from "@/lib/cms/cms-supabase-transport";

export type CmsSectionPublishedDisplay = {
  /** Si true : pas de titre de section dans l’app (uniquement les frames). */
  hide_section_title: boolean;
  /** Titre optionnel (hub, panier, etc.) — chaîne vide ignorée. */
  title: string | null;
};

export function parseCmsSectionPublishedDisplay(raw: unknown): CmsSectionPublishedDisplay {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { hide_section_title: false, title: null };
  }
  const o = raw as Record<string, unknown>;
  const hide = o.hide_section_title === true;
  const t = typeof o.title === "string" ? o.title.trim() : "";
  return { hide_section_title: hide, title: t || null };
}

/**
 * Lit `published_section_config` pour une section (RPC security definer).
 */
export async function fetchCmsSectionPublishedConfigRaw(
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<unknown> },
  sectionKey: string,
): Promise<unknown> {
  try {
    const { data, error } = (await supabase.rpc("get_cms_section_published_config", {
      p_section_key: sectionKey,
    })) as { data: unknown; error: { message?: string } | null };
    if (error) {
      const msg = error.message ?? "";
      const rpcMissing =
        msg.includes("Could not find the function") ||
        msg.includes("schema cache") ||
        /PGRST202|42883/i.test(msg);
      if (rpcMissing) {
        if (process.env.NODE_ENV === "development") {
          console.info(
            `[CMS] RPC get_cms_section_published_config absente — migration 20260407143000_cms_section_published_config_rpc.sql (section: ${sectionKey}).`,
          );
        }
      } else if (isSupabaseTransportFailure(msg)) {
        warnCmsSupabaseUnreachable(`get_cms_section_published_config "${sectionKey}"`, msg);
      } else {
        console.error("get_cms_section_published_config", sectionKey, msg);
      }
      return null;
    }
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnCmsSupabaseUnreachable(`get_cms_section_published_config "${sectionKey}"`, msg);
    return null;
  }
}

export async function fetchCmsSectionPublishedDisplay(
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<unknown> },
  sectionKey: string,
): Promise<CmsSectionPublishedDisplay> {
  const raw = await fetchCmsSectionPublishedConfigRaw(supabase, sectionKey);
  return parseCmsSectionPublishedDisplay(raw);
}
