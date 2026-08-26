import type { SupabaseClient } from "@supabase/supabase-js";

const MEMBER_MEDIA_BUCKETS = ["bucket_focus", "bucket_community"] as const;

async function listObjectPathsRecursive(
  admin: SupabaseClient,
  bucketId: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  const queue = [prefix.replace(/\/+$/, "")];

  while (queue.length > 0) {
    const folder = queue.shift()!;
    const { data, error } = await admin.storage.from(bucketId).list(folder, {
      limit: 1000,
      offset: 0,
    });
    if (error) {
      console.error("[purge-member-media] list", bucketId, folder, error.message);
      continue;
    }
    for (const entry of data ?? []) {
      if (!entry?.name) continue;
      const fullPath = folder ? `${folder}/${entry.name}` : entry.name;
      // Dossiers : id null / metadata null selon Storage.
      const isFolder = entry.id == null || entry.metadata == null;
      if (isFolder) {
        queue.push(fullPath);
      } else {
        paths.push(fullPath);
      }
    }
  }

  return paths;
}

/** Purge médias perso membre (profil / looks / inspirations). Ne touche pas bucket_items. */
export async function purgeMemberPersonalMedia(admin: SupabaseClient, userId: string): Promise<void> {
  const roots = [
    `users/${userId}/profile`,
    `users/${userId}/looks`,
    `users/${userId}/inspirations`,
  ];

  for (const bucketId of MEMBER_MEDIA_BUCKETS) {
    const toRemove: string[] = [];
    for (const root of roots) {
      // bucket_focus = profile+looks ; bucket_community = inspirations — on liste les 3 roots partout (no-op si vide).
      const paths = await listObjectPathsRecursive(admin, bucketId, root);
      toRemove.push(...paths);
    }
    for (let i = 0; i < toRemove.length; i += 100) {
      const chunk = toRemove.slice(i, i + 100);
      if (chunk.length === 0) continue;
      const { error } = await admin.storage.from(bucketId).remove(chunk);
      if (error) {
        console.error("[purge-member-media] remove", bucketId, error.message);
      }
    }
  }
}
