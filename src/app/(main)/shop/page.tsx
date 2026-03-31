import { MainContent } from "@/components/layout/MainContent";
import { ShopCatalog, type CategoryFilterOption, type ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function mapFilterRows(rows: unknown): { id: string; label: string }[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : null;
      const label =
        (typeof r.label === "string" && r.label.trim()) ||
        (typeof r.name === "string" && r.name.trim()) ||
        null;
      if (!id || !label) return null;
      return { id, label };
    })
    .filter((x): x is { id: string; label: string } => x !== null);
}

function mapCategoryFilterRows(rows: unknown): CategoryFilterOption[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : null;
      const label =
        (typeof r.label === "string" && r.label.trim()) ||
        (typeof r.name === "string" && r.name.trim()) ||
        null;
      if (!id || !label) return null;
      const rawParent = r.parent_category_id;
      const parentId = typeof rawParent === "string" && rawParent.trim() ? rawParent.trim() : null;
      return { id, label, parentId };
    })
    .filter((x): x is CategoryFilterOption => x !== null);
}

export default async function ShopPage() {
  const supabase = await createSupabaseServerClient();
  const anySb = supabase as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          is: (c: string, v: null) => Promise<{ data: unknown; error: { message?: string } | null }>;
        };
        order: (c: string, o?: { ascending?: boolean }) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const [catalogRes, favRes, catRes, sizeRes, brandRes, colRes, matRes] = await Promise.all([
    anySb.rpc("get_shop_catalog_items", { p_limit: 160 }),
    anySb.from("item_favorites").select("item_id").eq("user_id", user.id).is("deleted_at", null),
    anySb.from("item_categories").select("id,name,parent_category_id").order("name", { ascending: true }),
    anySb.from("sizes").select("id,label").order("label", { ascending: true }),
    anySb.from("item_brands").select("id,label").order("label", { ascending: true }),
    anySb.from("item_couleurs").select("id,label").order("label", { ascending: true }),
    anySb.from("item_materiaux").select("id,label").order("label", { ascending: true }),
  ]);

  const catalogPayload = (catalogRes.data ?? { items: [] }) as { items?: ShopCatalogItem[] };
  const initialItems = Array.isArray(catalogPayload.items) ? catalogPayload.items : [];

  const likedRows = (favRes.data ?? []) as Array<{ item_id?: string }>;
  const initialLikedItemIds = likedRows.map((r) => r.item_id).filter((id): id is string => typeof id === "string");

  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <ShopCatalog
        initialItems={initialItems}
        initialLikedItemIds={initialLikedItemIds}
        categories={mapCategoryFilterRows(catRes.data)}
        sizes={mapFilterRows(sizeRes.data)}
        brands={mapFilterRows(brandRes.data)}
        colors={mapFilterRows(colRes.data)}
        materials={mapFilterRows(matRes.data)}
      />
    </MainContent>
  );
}
