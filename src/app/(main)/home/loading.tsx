import { MainContent } from "@/components/layout/MainContent";
import { AppPageLoading } from "@/components/ui/AppPageLoading";

export default function HomeLoading() {
  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <AppPageLoading label="Chargement de l'accueil" />
    </MainContent>
  );
}
