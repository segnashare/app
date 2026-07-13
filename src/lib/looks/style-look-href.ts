import { MEMBER_HOME_HREF } from "@/components/layout/navigation";

export function styleLookHref(lookId: string): string {
  const id = lookId.trim();
  return id ? `/look/${id}` : MEMBER_HOME_HREF;
}
