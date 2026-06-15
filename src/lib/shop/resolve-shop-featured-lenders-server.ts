import type { ShopFeaturedLender } from "@/components/shop/ShopCatalog";
import { isSegnaCorporateInventoryUserId } from "@/lib/config/segna-corporate-inventory";
import {
  memberHasProfilePhotoSource,
  resolveProfilePhotoHttpUrl,
  resolveProfilePhotoStoragePath,
  resolveProfilePhotoTransform,
} from "@/lib/profile/parse-profile-photo-path";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createSignedUrlForStoragePath,
  type StorageSignClient,
} from "@/lib/supabase/storage-resolve-signed-url";

const PROFILE_SELECT = "user_id, display_name, photos, looks";
const FEATURED_LENDER_TARGET = 9;
const SIGN_TTL_SEC = 60 * 60 * 24;
/** Profils récents parcourus pour trouver des photos (sans critère de pièce prêtée). */
const PROFILE_CANDIDATE_POOL = 200;

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  photos: unknown;
  looks: unknown;
};

type ShopDbClient = StorageSignClient & {
  from: (table: string) => unknown;
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

async function fetchRecentProfileCandidates(db: ShopDbClient, limit: number): Promise<ProfileRow[]> {
  const { data, error } = await (db.from("user_profiles") as {
    select: (c: string) => {
      order: (
        col: string,
        opts?: { ascending?: boolean },
      ) => {
        limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  })
    .select(PROFILE_SELECT)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[shop.featuredLenders] profiles:", error.message);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data as ProfileRow[];
}

async function filterExcludedUserIds(
  db: ShopDbClient,
  userIds: string[],
  excludeUserId?: string,
): Promise<Set<string>> {
  const excluded = new Set<string>();
  if (excludeUserId) excluded.add(excludeUserId);
  if (userIds.length === 0) return excluded;

  const [usersRes, rolesRes] = await Promise.all([
    (db.from("users") as {
      select: (c: string) => {
        in: (col: string, vals: string[]) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    })
      .select("id, status, email, deleted_at, phantom_mode")
      .in("id", userIds),
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
      .in("user_id", userIds)
      .eq("role", "organization")
      .is("deleted_at", null),
  ]);

  if (Array.isArray(usersRes.data)) {
    for (const row of usersRes.data as Array<{
      id?: string;
      status?: string;
      email?: string | null;
      deleted_at?: string | null;
      phantom_mode?: boolean | null;
    }>) {
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) continue;
      if (row.deleted_at != null) excluded.add(id);
      if (isSegnaCorporateInventoryUserId(id)) excluded.add(id);
      if (row.status === "corporate_inventory") excluded.add(id);
      if (row.phantom_mode === true) excluded.add(id);
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

export type FetchShopFeaturedLendersOptions = {
  /** Base catalogue (admin démo ou service role prod). */
  catalogDb: ShopDbClient;
  maxMembers?: number;
  /** Membre connecté : exclu de la grille. */
  excludeUserId?: string;
};

/**
 * Jusqu’à N membres avec au moins une photo de profil (looks ou photos).
 * Aucune pièce prêtée requise.
 */
export async function fetchShopFeaturedLendersWithProfilePhotos(
  options: FetchShopFeaturedLendersOptions,
): Promise<ShopFeaturedLender[]> {
  const maxMembers = options.maxMembers ?? FEATURED_LENDER_TARGET;
  const adminSigner = tryCreateSupabaseAdminClient();
  const db = (adminSigner ?? options.catalogDb) as ShopDbClient;
  const signClients: StorageSignClient[] = [options.catalogDb];
  if (adminSigner) signClients.unshift(adminSigner as StorageSignClient);

  const candidates = await fetchRecentProfileCandidates(db, PROFILE_CANDIDATE_POOL);
  if (candidates.length === 0) return [];

  const excluded = await filterExcludedUserIds(
    db,
    candidates.map((p) => p.user_id),
    options.excludeUserId,
  );

  const result: ShopFeaturedLender[] = [];

  for (const profile of candidates) {
    if (result.length >= maxMembers) break;
    if (excluded.has(profile.user_id)) continue;

    const source = profileRowToSource(profile);
    if (!memberHasProfilePhotoSource(source)) continue;

    const avatarUrl = await resolveAvatarUrl(signClients, source);
    const avatarTransform = resolveProfilePhotoTransform(source);

    result.push({
      userId: profile.user_id,
      displayName: displayNameFromRow(profile),
      avatarUrl,
      avatarTransform,
    });
  }

  return result;
}
