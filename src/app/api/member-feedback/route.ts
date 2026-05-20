import { NextResponse } from "next/server";

import {
  isMemberFeedbackCategoryId,
  type MemberFeedbackCategoryId,
} from "@/lib/feedback/member-feedback-categories";
import { notifyMemberFeedbackN8n } from "@/lib/feedback/notify-member-feedback-n8n";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const DETAILS_MIN = 10;
const DETAILS_MAX = 4000;
const PAGE_PATH_MAX = 512;

export async function POST(request: Request) {
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const categoryRaw = typeof (body as { category?: unknown })?.category === "string"
    ? (body as { category: string }).category.trim()
    : "";
  const detailsRaw = typeof (body as { details?: unknown })?.details === "string"
    ? (body as { details: string }).details.trim()
    : "";
  const pagePathRaw = typeof (body as { pagePath?: unknown })?.pagePath === "string"
    ? (body as { pagePath: string }).pagePath.trim()
    : "";

  if (!isMemberFeedbackCategoryId(categoryRaw)) {
    return NextResponse.json({ error: "Type de signalement invalide" }, { status: 400 });
  }
  const category = categoryRaw as MemberFeedbackCategoryId;

  if (detailsRaw.length < DETAILS_MIN) {
    return NextResponse.json(
      { error: `Merci de décrire la situation (au moins ${DETAILS_MIN} caractères).` },
      { status: 400 },
    );
  }
  if (detailsRaw.length > DETAILS_MAX) {
    return NextResponse.json({ error: "Description trop longue." }, { status: 400 });
  }

  const pagePath = pagePathRaw.slice(0, PAGE_PATH_MAX) || "/";

  const userId = user.id as string;
  const userEmail = typeof user.email === "string" ? user.email.trim() || null : null;

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle<{ first_name?: string | null; last_name?: string | null }>();

  const n8n = await notifyMemberFeedbackN8n({
    userId,
    userEmail,
    userFirstName: profile?.first_name?.trim() || null,
    userLastName: profile?.last_name?.trim() || null,
    category,
    details: detailsRaw,
    pagePath,
  });

  if (!n8n.ok) {
    if (n8n.reason === "missing_url") {
      return NextResponse.json({ error: "Service temporairement indisponible." }, { status: 503 });
    }
    return NextResponse.json({ error: "Envoi impossible. Réessaie dans un instant." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
