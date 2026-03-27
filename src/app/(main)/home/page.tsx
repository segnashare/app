import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HomeFeedV1 } from "@/components/home/HomeFeedV1";
import { MainContent } from "@/components/layout/MainContent";

type RawPhotos = unknown;

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const anySupabase = supabase as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<{
      data: unknown;
      error: { message?: string } | null;
    }>;
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          is: (column: string, value: null) => {
            in: (column: string, values: string[]) => Promise<{
              data: Array<{ item_id: string }> | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("user_profiles").select("display_name").eq("user_id", user.id).maybeSingle()
    : { data: null };

  const profileDisplayName =
    typeof profile?.display_name === "string" && profile.display_name.trim() ? profile.display_name.trim() : null;
  const fallbackDisplayName =
    (typeof user?.user_metadata?.display_name === "string" && user.user_metadata.display_name.trim()) ||
    (typeof user?.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    user?.email?.split("@")[0] ||
    "Profil";
  const displayName = profileDisplayName ?? fallbackDisplayName;

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
      status?: "listed" | "available" | null;
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

  const initialCards = (feedData.cards ?? []).flatMap((card) => {
    if (card.kind === "item" && card.item_id && card.status) {
      return [
        {
          kind: "item" as const,
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
        },
      ];
    }
    if (card.kind === "profile" && card.profile_user_id) {
      return [
        {
          kind: "profile" as const,
          id: card.profile_user_id,
          displayName: (card.profile_display_name ?? "").trim() || "Membre Segna",
          city: card.profile_city ?? null,
          age: typeof card.profile_age === "number" ? card.profile_age : null,
        },
      ];
    }
    return [];
  });

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

  return (
    <MainContent className="pb-2 pt-6">
      <HomeFeedV1
        initialCards={initialCards}
        initialLikedItemIds={likedItemIds}
        initialCursor={feedData.next_cursor ?? null}
      />
    </MainContent>
  );
}
