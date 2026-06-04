import { NextResponse } from "next/server";

/** Achat de packs crédits retiré (économie v2). */
export async function POST() {
  return NextResponse.json(
    { message: "L'achat de packs crédits n'est plus disponible." },
    { status: 410 },
  );
}
