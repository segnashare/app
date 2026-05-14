import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Ferme la modale « bonus parrain » pour l’utilisatrice connectée (parrain). */
export async function POST() {
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { error } = await supabase.from("users").update({ referrer_bonus_modal: null }).eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message ?? "Mise à jour impossible" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
