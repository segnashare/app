import { AuthWelcomePageClient } from "@/components/auth/AuthWelcomePageClient";
import { fetchAuthLandingCollageResolved } from "@/lib/cms/fetch-auth-landing-collage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function preloadLinksForFrames(frames: Awaited<ReturnType<typeof fetchAuthLandingCollageResolved>>) {
  const urls = frames
    .map((row) => row.payload.collage_image?.signed_url)
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .slice(0, 8);

  return urls.map((href, i) => (
    <link key={`auth-collage-preload-${i}`} rel="preload" as="image" href={href} fetchPriority={i < 4 ? "high" : "auto"} />
  ));
}

export default async function AuthWelcomePage() {
  const supabase = await createSupabaseServerClient();
  const collageFrames = await fetchAuthLandingCollageResolved(supabase);

  return (
    <>
      {preloadLinksForFrames(collageFrames)}
      <AuthWelcomePageClient initialCollageFrames={collageFrames} />
    </>
  );
}
