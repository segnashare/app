import { notFound } from "next/navigation";

import { CreateInspirationFlow } from "@/components/community/CreateInspirationFlow";
import { MainContent } from "@/components/layout/MainContent";

export default function CommunityCreatePage() {
  return (
    <MainContent>
      <CreateInspirationFlow />
    </MainContent>
  );
}
