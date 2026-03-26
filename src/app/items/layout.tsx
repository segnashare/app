import type { ReactNode } from "react";

import { MainShell } from "@/components/layout/MainShell";

/** Session : middleware (`PROTECTED_PREFIXES` inclut `/items`). */
export default function ItemsLayout({ children }: { children: ReactNode }) {
  return <MainShell>{children}</MainShell>;
}
