import { notFound, redirect } from "next/navigation";

import { urlSourceToDbSource } from "@/lib/community/community-source";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageProps = {
  params: Promise<{ source: string; id: string }>;
};

export default async function InspirationDetailPage({ params }: PageProps) {
  const { source: urlSource, id } = await params;
  const dbSource = urlSourceToDbSource(urlSource);

  if (!dbSource || !UUID_RE.test(id)) {
    notFound();
  }

  redirect(`/look/${id}`);
}
