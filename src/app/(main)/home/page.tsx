import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CardBase } from "@/components/layout/CardBase";
import { MainContent } from "@/components/layout/MainContent";
import { SectionBlock } from "@/components/layout/SectionBlock";

const SCROLL_TEST_BLOCKS = Array.from({ length: 18 }, (_, index) => ({
  id: `scroll-test-${index + 1}`,
  title: `Bloc scroll ${index + 1}`,
  text: "Contenu de test pour verifier le comportement hide/show de la tabbar pendant un scroll long.",
}));

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
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

  return (
    <>
      <header className="flex items-start justify-between gap-3 px-5 pb-2 pt-8">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#8B6A54]">Segna</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950">Home</h1>
        </div>

        <p className="max-w-[42vw] truncate pt-0.5 text-right text-sm font-medium text-zinc-700">{displayName}</p>
      </header>

      <MainContent>
        <SectionBlock title="Reperes constants" description="Structure stable pour ancrer la navigation principale.">
          <CardBase>
            <p className="text-sm text-zinc-700">Le shell garde une largeur mobile homogène, des marges constantes et une tabbar persistante.</p>
          </CardBase>
        </SectionBlock>

        <SectionBlock title="Long frame de test" description="Zone volontairement longue pour tester le scroll sur la homepage.">
          <div className="space-y-3">
            {SCROLL_TEST_BLOCKS.map((block) => (
              <CardBase key={block.id} className="min-h-28">
                <p className="text-sm font-semibold text-zinc-900">{block.title}</p>
                <p className="mt-2 text-sm text-zinc-600">{block.text}</p>
              </CardBase>
            ))}
          </div>
        </SectionBlock>
      </MainContent>
    </>
  );
}
