import { UUID_RE } from "@/lib/item-chat/types";

export function readVisitorIdFromRequest(request: Request, bodyVisitorId?: unknown): string | null {
  const header = request.headers.get("x-segna-chat-visitor")?.trim() || "";
  if (UUID_RE.test(header)) return header.toLowerCase();
  if (typeof bodyVisitorId === "string" && UUID_RE.test(bodyVisitorId.trim())) {
    return bodyVisitorId.trim().toLowerCase();
  }
  return null;
}
