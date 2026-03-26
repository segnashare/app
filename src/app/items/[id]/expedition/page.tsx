import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

/** Ancienne URL : expédition regroupée sur la fiche pièce (bandeau intake). */
export default async function ItemExpeditionLegacyRedirect({ params }: Props) {
  const { id } = await params;
  redirect(`/items/${encodeURIComponent(id)}`);
}
