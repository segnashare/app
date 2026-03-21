import { CardBase } from "@/components/layout/CardBase";
import { MainContent } from "@/components/layout/MainContent";
import { SectionBlock } from "@/components/layout/SectionBlock";

export default function ShopPage() {
  return (
    <>
      <header className="px-5 pb-2 pt-8">
        <h1 className="text-2xl font-semibold text-zinc-950">Shop</h1>
      </header>

      <MainContent>
        <SectionBlock title="Catalogue" description="Exemple de section avec rythme vertical unifie.">
          <CardBase>
            <p className="text-sm text-zinc-700">Les cards, separateurs et CTA suivent les memes patterns sur tous les onglets.</p>
          </CardBase>
        </SectionBlock>
      </MainContent>
    </>
  );
}
