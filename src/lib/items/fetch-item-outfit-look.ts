import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

export type ItemOutfitCompanionRef = {
  item_id: string;
  role_label: string | null;
  sort_order: number;
};

export type ItemOutfitLookPayload = {
  title: string;
  intro: string;
  companions: ItemOutfitCompanionRef[];
};

export async function fetchItemOutfitLook(
  supabase: StorageSignClient,
  itemId: string,
): Promise<ItemOutfitLookPayload | null> {
  const id = itemId.trim();
  if (!id) return null;

  const rpc = supabase as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const { data, error } = await rpc.rpc("get_item_outfit_look", { p_item_id: id });
  if (error || data == null) {
    if (process.env.NODE_ENV === "development" && error?.message) {
      console.info("[Outfit] get_item_outfit_look:", error.message);
    }
    return null;
  }

  if (typeof data !== "object" || Array.isArray(data)) return null;
  const root = data as { title?: unknown; intro?: unknown; companions?: unknown };
  const companionsRaw = Array.isArray(root.companions) ? root.companions : [];
  const companions: ItemOutfitCompanionRef[] = [];

  for (const entry of companionsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { item_id?: unknown; role_label?: unknown; sort_order?: unknown };
    const companionId = typeof row.item_id === "string" ? row.item_id.trim() : "";
    if (!companionId) continue;
    companions.push({
      item_id: companionId,
      role_label: typeof row.role_label === "string" ? row.role_label : null,
      sort_order: typeof row.sort_order === "number" ? row.sort_order : companions.length,
    });
  }

  companions.sort((a, b) => a.sort_order - b.sort_order);

  return {
    title: typeof root.title === "string" ? root.title : "",
    intro: typeof root.intro === "string" ? root.intro : "",
    companions,
  };
}
