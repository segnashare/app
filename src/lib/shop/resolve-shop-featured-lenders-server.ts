import type { ShopFeaturedLender } from "@/components/shop/ShopCatalog";
import { isSegnaCorporateInventoryUserId } from "@/lib/config/segna-corporate-inventory";
import {
  memberHasProfilePhotoSource,
  resolveProfilePhotoHttpUrl,
  resolveProfilePhotoStoragePath,
} from "@/lib/profile/parse-profile-photo-path";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createSignedUrlForStoragePath,
  type StorageSignClient,
} from "@/lib/supabase/storage-resolve-signed-url";

const PROFILE_SELECT = "user_id, display_name, photos, looks";
const FEATURED_LENDER_TARGET = 9;
/** Pièces effectivement prêtées au catalogue (disponibles à l’emprunt). */
const LENDER_ITEM_STATUS = "available" as const;
const SIGN_TTL_SEC = 60 * 60 * 24;
/** Candidats à parcourir pour remplir 9 profils avec photo (au-delà du top 9 strict). */
const OWNER_CANDIDATE_POOL = 80;

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  photos: unknown;
  looks: unknown;
};

type ShopDbClient = StorageSignClient & {
  from: (table: string) => unknown;
};

type OwnerRank = {
  userId: string;
  availableCount: number;
  lastItemAt: string;
};

function displayNameFromRow(row: ProfileRow): string {
  return typeof row.display_name === "string" && row.display_name.trim()
    ? row.display_name.trim()
    : "Membre";
}

function profileRowToSource(row: ProfileRow): Record<string, unknown> {
  return { photos: row.photos, looks: row.looks };
}

async function resolveAvatarUrl(
  signClients: StorageSignClient[],
  row: Record<string, unknown>,
): Promise<string | null> {
  const publicUrl = resolveProfilePhotoHttpUrl(row);
  if (publicUrl) return publicUrl;

  const path = resolveProfilePhotoStoragePath(row);
  if (!path) return null;

  for (const client of signClients) {
    const signed = await createSignedUrlForStoragePath(client, path, SIGN_TTL_SEC, {
      explicitBucket: "bucket_focus",
    });
    if (signed) return signed;
    const signedAuto = await createSignedUrlForStoragePath(client, path, SIGN_TTL_SEC);
    if (signedAuto) return signedAuto;
  }
  return null;
}

async function rankOwnersByAvailableItemCount(db: ShopDbClient): Promise<OwnerRank[]> {
  const { data: itemRows, error } = await (db.from("items") as {
    select: (c: string) => {
      eq: (col: string, val: string) => {
        is: (col: string, val: null) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  })
    .select("owner_user_id, updated_at")
    .eq("status", LENDER_ITEM_STATUS)
    .is("deleted_at", null);

  if (error || !Array.isArray(itemRows)) {
    if (error) console.error("[shop.featuredLenders] items:", error.message);
    return [];
  }

  const counts = new Map<string, { cnt: number; lastItemAt: string }>();
  for (const raw of itemRows as Array<{ owner_user_id?: string; updated_at?: string }>) {
    const ownerId = typeof raw.owner_user_id === "string" ? raw.owner_user_id.trim() : "";
    if (!ownerId) continue;
    const updatedAt = typeof raw.updated_at === "string" ? raw.updated_at : "";
    const prev = counts.get(ownerId);
    if (!prev) {
      counts.set(ownerId, { cnt: 1, lastItemAt: updatedAt });
      continue;
    }
    counts.set(ownerId, {
      cnt: prev.cnt + 1,
      lastItemAt: updatedAt > prev.lastItemAt ? updatedAt : prev.lastItemAt,
    });
  }

  return [...counts.entries()]
    .map(([userId, { cnt, lastItemAt }]) => ({
      userId,
      availableCount: cnt,
      lastItemAt,
    }))
    .sort((a, b) => b.availableCount - a.availableCount || b.lastItemAt.localeCompare(a.lastItemAt));
}

async function filterExcludedOwnerIds(db: ShopDbClient, ownerIds: string[]): Promise<Set<string>> {
  const excluded = new Set<string>();
  if (ownerIds.length === 0) return excluded;

  const [usersRes, rolesRes] = await Promise.all([
    (db.from("users") as {
      select: (c: string) => {
        in: (col: string, vals: string[]) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    })
      .select("id, status, email")
      .in("id", ownerIds),
    (db.from("user_roles") as {
      select: (c: string) => {
        in: (col: string, vals: string[]) => {
          eq: (col: string, val: string) => {
            is: (col: string, val: null) => Promise<{ data: unknown; error: { message?: string } | null }>;
          };
        };
      };
    })
      .select("user_id")
      .in("user_id", ownerIds)
      .eq("role", "organization")
      .is("deleted_at", null),
  ]);

  if (Array.isArray(usersRes.data)) {
    for (const row of usersRes.data as Array<{ id?: string; status?: string; email?: string | null }>) {
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) continue;
      if (isSegnaCorporateInventoryUserId(id)) excluded.add(id);
      if (row.status === "corporate_inventory") excluded.add(id);
      const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
      if (email.endsWith("@segnashare.com")) excluded.add(id);
    }
  }

  if (Array.isArray(rolesRes.data)) {
    for (const row of rolesRes.data as Array<{ user_id?: string }>) {
      const id = typeof row.user_id === "string" ? row.user_id.trim() : "";
      if (id) excluded.add(id);
    }
  }

  return excluded;
}

async function fetchProfilesByUserIds(db: ShopDbClient, userIds: string[]): Promise<Map<string, ProfileRow>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await (db.from("user_profiles") as {
    select: (c: string) => {
      in: (col: string, vals: string[]) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
  })
    .select(PROFILE_SELECT)
    .in("user_id", userIds);

  if (error) {
    console.error("[shop.featuredLenders] profiles:", error.message);
    return new Map();
  }
  if (!Array.isArray(data)) return new Map();

  return new Map((data as ProfileRow[]).map((p) => [p.user_id, p] as const));
}

export type FetchShopFeaturedLendersOptions = {
  /** Base catalogue (admin démo ou service role prod). */
  catalogDb: ShopDbClient;
  maxMembers?: number;
};

/**
 * Top N prêteuses : plus de pièces `available`, avec photo de profil résolvable.
 * Pas de profils factices — moins de 9 si pas assez de membres éligibles.
 */
export async function fetchShopFeaturedLendersWithProfilePhotos(
  options: FetchShopFeaturedLendersOptions,
): Promise<ShopFeaturedLender[]> {
  const maxMembers = options.maxMembers ?? FEATURED_LENDER_TARGET;
  const adminSigner = tryCreateSupabaseAdminClient();
  const db = (adminSigner ?? options.catalogDb) as ShopDbClient;
  const signClients: StorageSignClient[] = [options.catalogDb];
  if (adminSigner) signClients.unshift(adminSigner as StorageSignClient);

  const rankedOwners = await rankOwnersByAvailableItemCount(db);
  if (rankedOwners.length === 0) return [];

  const candidatePool = rankedOwners.slice(0, OWNER_CANDIDATE_POOL);
  const excluded = await filterExcludedOwnerIds(
    db,
    candidatePool.map((o) => o.userId),
  );
  const eligibleRanked = candidatePool.filter((o) => !excluded.has(o.userId));

  const result: ShopFeaturedLender[] = [];
  let scanFrom = 0;

  while (result.length < maxMembers && scanFrom < eligibleRanked.length) {
    const batchSize = Math.min(maxMembers - result.length + 12, eligibleRanked.length - scanFrom);
    const batch = eligibleRanked.slice(scanFrom, scanFrom + batchSize);
    scanFrom += batchSize;

    const profiles = await fetchProfilesByUserIds(
      db,
      batch.map((o) => o.userId),
    );

    for (const { userId } of batch) {
      if (result.length >= maxMembers) break;
      const profile = profiles.get(userId);
      if (!profile) continue;

      const source = profileRowToSource(profile);
      if (!memberHasProfilePhotoSource(source)) continue;

      const avatarUrl = await resolveAvatarUrl(signClients, source);
      if (!avatarUrl) continue;

      result.push({
        userId,
        displayName: displayNameFromRow(profile),
        avatarUrl,
      });
    }
  }

  return result;
}
