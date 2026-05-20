import {
  memberFeedbackCategoryLabel,
  type MemberFeedbackCategoryId,
} from "@/lib/feedback/member-feedback-categories";

export type MemberFeedbackN8nNotifyInput = {
  userId: string;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  category: MemberFeedbackCategoryId;
  details: string;
  pagePath: string;
};

export type MemberFeedbackN8nNotifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_url" | "http_error" | "network_error"; detail?: string };

/** Tolère un commentaire inline dans `.env` (ex. `https://…/webhook/xxx #prod`). */
function readMemberFeedbackWebhookUrl(): string {
  const raw =
    process.env.N8N_ITEM_PROBLEM_REPORT_WEBHOOK_URL?.trim() ||
    process.env.N8N_MEMBER_FEEDBACK_WEBHOOK_URL?.trim() ||
    "";
  if (!raw) return "";
  return raw.split("#")[0]?.trim() ?? "";
}

function readMemberFeedbackWebhookSecret(): string {
  return (
    process.env.N8N_ITEM_PROBLEM_REPORT_WEBHOOK_SECRET?.trim() ||
    process.env.N8N_MEMBER_FEEDBACK_WEBHOOK_SECRET?.trim() ||
    ""
  );
}

/**
 * Déclenche le workflow n8n (`N8N_MEMBER_FEEDBACK_WEBHOOK_URL`) après signalement membre.
 */
export async function notifyMemberFeedbackN8n(
  input: MemberFeedbackN8nNotifyInput,
): Promise<MemberFeedbackN8nNotifyResult> {
  const url = readMemberFeedbackWebhookUrl();
  if (!url) {
    console.error(
      "[n8n/member-feedback] N8N_ITEM_PROBLEM_REPORT_WEBHOOK_URL (ou N8N_MEMBER_FEEDBACK_WEBHOOK_URL) is not set",
    );
    return { ok: false, reason: "missing_url" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = readMemberFeedbackWebhookSecret();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const payload = {
    event: "member_feedback_submitted",
    user_id: input.userId,
    user_email: input.userEmail,
    user_first_name: input.userFirstName,
    user_last_name: input.userLastName,
    category: input.category,
    category_label: memberFeedbackCategoryLabel(input.category),
    details: input.details,
    page_path: input.pagePath,
    submitted_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = `${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
      console.warn("[n8n/member-feedback] webhook HTTP", detail);
      return { ok: false, reason: "http_error", detail };
    }
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[n8n/member-feedback] webhook failed", detail);
    return { ok: false, reason: "network_error", detail };
  }
}
