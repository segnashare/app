import { LegalPrivacyPreferencesClient } from "@/components/legal/LegalPrivacyPreferencesClient";

type ConfidentialitePageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function ConfidentialitePage({ searchParams }: ConfidentialitePageProps) {
  const { tab } = await searchParams;
  const backTab = tab === "me" ? "me" : "plus";

  return <LegalPrivacyPreferencesClient settingsHref={`/profile/settings?tab=${backTab}`} />;
}
