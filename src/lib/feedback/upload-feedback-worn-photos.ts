import type { SupabaseClient } from "@supabase/supabase-js";

const WORN_PHOTO_BUCKET = "bucket_items";
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 3;

export async function uploadFeedbackWornPhotos(
  admin: SupabaseClient,
  userId: string,
  cartId: string,
  cartItemId: string,
  files: File[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files.slice(0, MAX_PHOTOS)) {
    if (!file.type.startsWith("image/") || file.size <= 0 || file.size > MAX_PHOTO_BYTES) continue;
    const ext =
      file.name.includes(".")
        ? (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg"
        : "jpg";
    const path = `users/${userId}/feedback_return/${cartId}/${cartItemId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await admin.storage.from(WORN_PHOTO_BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
    if (!error) paths.push(path);
  }
  return paths;
}
