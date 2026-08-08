import { NextResponse } from "next/server";

/**
 * Apple App Site Association — Universal Links vers l’app native.
 * Requiert `APPLE_TEAM_ID` (Team ID Developer Apple, 10 caractères).
 * @see https://developer.apple.com/documentation/xcode/supporting-associated-domains
 */
export async function GET() {
  const teamId = (process.env.APPLE_TEAM_ID ?? process.env.NEXT_PUBLIC_APPLE_TEAM_ID ?? "").trim();
  const bundleId = "com.segnashare.mobile";

  if (!teamId) {
    return NextResponse.json(
      { error: "APPLE_TEAM_ID manquant — Universal Links non configurés." },
      { status: 503 },
    );
  }

  const body = {
    applinks: {
      apps: [] as string[],
      details: [
        {
          appID: `${teamId}.${bundleId}`,
          paths: [
            "/commande/*",
            "/cart",
            "/cart/*",
            "/package",
            "/package/*",
            "/profile",
            "/profile/*",
            "/auth/*",
            "/onboarding",
            "/onboarding/*",
            "/shop",
            "/shop/*",
            "/items/*",
            "/look/*",
            "/exchange",
            "/exchange/*",
            "/abonnement/*",
          ],
        },
      ],
    },
    webcredentials: {
      apps: [`${teamId}.${bundleId}`],
    },
  };

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
