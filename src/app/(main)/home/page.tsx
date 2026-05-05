import { redirect } from "next/navigation";

/** Landing membre = catalogue. Ancienne implémentation : `src/archived/home-feed-page/HomePage.v1.archived.tsx`. */
export default function HomeArchivedRedirectPage() {
  redirect("/shop");
}
