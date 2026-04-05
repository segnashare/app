import { notFound } from "next/navigation";

import { MainContent } from "@/components/layout/MainContent";
import { MemberProfileById } from "@/components/member/MemberProfileById";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MembrePage({ params }: PageProps) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    notFound();
  }

  return (
    <MainContent className="!space-y-0 !pb-28 !pt-0">
      <MemberProfileById userId={id} />
    </MainContent>
  );
}
