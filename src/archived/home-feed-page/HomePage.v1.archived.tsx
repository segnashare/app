/**
 * Archive — ancienne page `/home` (fil d’accueil `get_home_feed_v1` + `HomeFeedV1`).
 * Non montée par l’app : la route `src/app/(main)/home/page.tsx` redirige vers `/shop`.
 * Conserver ce fichier comme référence si on réactive le feed plus tard.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HomeFeedV1 } from "@/components/home/HomeFeedV1";
import { MainContent } from "@/components/layout/MainContent";

type RawPhotos = unknown;
type FeedAdBanner = {
  id: string;
  placementKey: string;
  title: string;
  imageUrl: string;
  targetUrl: string;
};
type InitialFeedCard =
  | {
      kind: "item";
      id: string;
      title: string;
      description: string;
      status: string;
      pricePoints: number | null;
      ownerUserId: string;
      ownerDisplayName: string | null;
      rawPhotos: RawPhotos;
      categorie: string | null;
      sizeLabel: string | null;
      materialsLabel: string | null;
      colorLabel: string | null;
      brandLabel: string | null;
      conditionLabel: string | null;
    }
  | {
      kind: "profile";
      id: string;
      displayName: string;
      city: string | null;
      age: number | null;
    };

export default async function HomePageV1Archived() {
  const supabase = await createSupabaseServerClient();
  type QueryResult<T> = Promise<{
    data: T | null;
    error: { message?: string } | null;
  }>;
  type QueryBuilder = {
    eq: (column: string, value: unknown) => QueryBuilder;
    is: (column: string, value: null) => QueryBuilder;
    in: (column: string, values: string[]) => QueryResult<Array<{ item_id: string }>>;
    order: (column: string, options: { ascending: boolean }) => QueryBuilder;
    limit: (count: number) => QueryBuilder;
    maybeSingle: () => QueryResult<Record<string, unknown>>;
  };
  const anySupabase = supabase as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<{
      data: unknown;
      error: { message?: string } | null;
    }>;
    from: (table: string) => {
      select: (columns: string) => QueryBuilder;
    };
  };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const feedRes = user
    ? await anySupabase.rpc("get_home_feed_v1", {
        p_limit: 24,
        p_cursor_score: null,
        p_cursor_entity_id: null,
        p_exploration_ratio: 0.2,
      })
    : { data: { cards: [], next_cursor: null }, error: null };

  const feedData = (feedRes.data ?? { cards: [], next_cursor: null }) as {
    cards?: Array<{
      kind: "item" | "profile";
      id: string;
      title?: string | null;
      description?: string | null;
      price_points?: number | null;
          status?: string | null;
      item_id?: string | null;
      profile_user_id?: string | null;
      owner_user_id?: string | null;
      photos?: RawPhotos;
      category_label?: string | null;
      categorie?: string | null;
      size_label?: string | null;
      materials_label?: string | null;
      color_label?: string | null;
      brand_label?: string | null;
      condition_label?: string | null;
      profile_display_name?: string | null;
      profile_city?: string | null;
      profile_age?: number | null;
    }>;
    next_cursor?: { score: number; entity_id: string } | null;
  };

  const initialCards: InitialFeedCard[] = [];
  for (const card of feedData.cards ?? []) {
    if (card.kind === "item" && card.item_id && card.status) {
      initialCards.push({
        kind: "item",
        id: card.item_id,
        title: card.title ?? "Piece",
        description: card.description ?? "",
        status: card.status,
        pricePoints: card.price_points ?? null,
        ownerUserId: card.owner_user_id ?? "",
        ownerDisplayName: (card.profile_display_name ?? "").trim() || null,
        rawPhotos: card.photos ?? null,
        categorie: card.categorie ?? card.category_label ?? null,
        sizeLabel: card.size_label ?? null,
        materialsLabel: card.materials_label ?? null,
        colorLabel: card.color_label ?? null,
        brandLabel: card.brand_label ?? null,
        conditionLabel: card.condition_label ?? null,
      });
      continue;
    }
    if (card.kind === "profile" && card.profile_user_id) {
      initialCards.push({
        kind: "profile",
        id: card.profile_user_id,
        displayName: (card.profile_display_name ?? "").trim() || "Membre Segna",
        city: card.profile_city ?? null,
        age: typeof card.profile_age === "number" ? card.profile_age : null,
      });
    }
  }

  const likedItemsRes =
    user && initialCards.some((card) => card.kind === "item")
      ? await anySupabase
          .from("item_favorites")
          .select("item_id")
          .eq("user_id", user.id)
          .is("deleted_at", null)
          .in(
            "item_id",
            initialCards.filter((card) => card.kind === "item").map((item) => item.id),
          )
      : { data: [], error: null };
  const likedItemIds = (likedItemsRes.data ?? []).map((row) => row.item_id);

  const activeAdRes = await anySupabase
    .from("cms_app_ad_placements")
    .select("id,placement_key,title,image_url,target_url")
    .eq("placement_key", "home_feed_top")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  const activeAdBanner: FeedAdBanner | null = activeAdRes.data
    ? {
        id: String(activeAdRes.data.id),
        placementKey: String(activeAdRes.data.placement_key),
        title: String(activeAdRes.data.title),
        imageUrl: String(activeAdRes.data.image_url),
        targetUrl: String(activeAdRes.data.target_url),
      }
    : null;

  return (
    <MainContent className="pb-2 pt-6">
      <HomeFeedV1
        initialCards={initialCards}
        initialLikedItemIds={likedItemIds}
        initialCursor={feedData.next_cursor ?? null}
        initialAdBanner={activeAdBanner}
      />
    </MainContent>
  );
}
