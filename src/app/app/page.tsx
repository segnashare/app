import { redirect } from "next/navigation";

import { MEMBER_HOME_HREF } from "@/components/layout/navigation";

export default function AppLegacyRoutePage() {
  redirect(MEMBER_HOME_HREF);
}
