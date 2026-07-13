import type { ReactNode } from "react";

import { MainShell } from "@/components/layout/MainShell";

export default function LookLayout({ children }: { children: ReactNode }) {
  return <MainShell>{children}</MainShell>;
}
