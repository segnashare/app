/** Même fiche que le site (`segna-web/website/src/lib/catalog/catalog-app-links.ts`). */
export const DEFAULT_SEGNA_APP_STORE_URL = "https://apps.apple.com/fr/app/segna/id6799780391";

export type ClubPlanCode = "club" | "club_plus";

export function isClubPlanCode(value: string | null | undefined): value is ClubPlanCode {
  return value === "club" || value === "club_plus";
}

export function clubPlanLabel(plan: ClubPlanCode): "Club" | "Club+" {
  return plan === "club_plus" ? "Club+" : "Club";
}

export function clubWelcomeSentence(plan: ClubPlanCode): string {
  return plan === "club_plus" ? "Bienvenue dans le Club+." : "Bienvenue dans le Club.";
}

export function segnaAppStoreUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SEGNA_APP_STORE_URL?.trim() ?? "";
  if (fromEnv.startsWith("https://")) return fromEnv;
  return DEFAULT_SEGNA_APP_STORE_URL;
}

/** SMS de bienvenue abonnement (Club, Club+, segna_x, segna_plus). */
export function clubWelcomeSmsBody(_plan?: string, _appStoreUrl?: string): string {
  return "Bienvenue sur Segna !";
}

export function formatEuroFromCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function clubAmountLabel(cents: number | null | undefined): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  return formatEuroFromCents(Math.trunc(cents));
}

export function checkoutSessionCustomerEmail(session: {
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
}): string | null {
  const fromDetails = session.customer_details?.email?.trim() ?? "";
  if (fromDetails.includes("@")) return fromDetails;
  const fromSession = session.customer_email?.trim() ?? "";
  if (fromSession.includes("@")) return fromSession;
  return null;
}

export function clubReceiptEmailCopy(input: {
  prenom: string;
  plan: ClubPlanCode;
  amountLabel: string | null;
  receiptUrl: string | null;
  invoiceAttached: boolean;
}): { subject: string; text: string } {
  const label = clubPlanLabel(input.plan);
  const lines = [
    `${input.prenom},`,
    "",
    `${clubWelcomeSentence(input.plan)} Ton abonnement ${label} est confirmé.`,
  ];
  if (input.amountLabel) {
    lines.push("", `Montant : ${input.amountLabel}.`);
  }
  if (input.receiptUrl) {
    lines.push("", `Retrouve ton reçu et ta facture Stripe ici : ${input.receiptUrl}`);
  }
  if (input.invoiceAttached) {
    lines.push("", "Ta facture Stripe est jointe à cet e-mail (PDF).");
  }
  lines.push("", "L’équipe Segna");
  return { subject: `Ton reçu ${label}`, text: lines.join("\n") };
}
