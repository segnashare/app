import { createClient } from "npm:@supabase/supabase-js@2";

type OnboardingWebhookPayload = {
  userId: string;
  event: "started" | "step_saved" | "completed";
  metadata?: Record<string, unknown>;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payload = (await req.json()) as OnboardingWebhookPayload;

  // Skeleton only: extend with integration side effects (CRM, analytics, etc.).
  const { error } = await supabase.from("onboarding_sessions").select("id").eq("user_id", payload.userId).maybeSingle();

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }

  return Response.json({ ok: true, received: payload.event }, { status: 200 });
});
