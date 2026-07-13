import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ShopTagLegacyRedirect({ params }: PageProps) {
  const { slug: rawSlug } = await params;
  const pageSlug = rawSlug.trim();
  if (!pageSlug) redirect("/shop");
  redirect(`/shop/${encodeURIComponent(pageSlug)}`);
}
