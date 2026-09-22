"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  AUTH_TEASER_LANDING_PATH,
  AUTH_TEASER_MODE,
  isAuthTeaserAllowedPath,
} from "@/lib/auth/auth-teaser";

/** Filet client : si une page fuit le middleware teaser, renvoyer vers le CTA iOS. */
export function AuthTeaserGate() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!AUTH_TEASER_MODE) return;
    if (isAuthTeaserAllowedPath(pathname)) return;
    router.replace(AUTH_TEASER_LANDING_PATH);
  }, [pathname, router]);

  return null;
}
