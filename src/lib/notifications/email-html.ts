import { getServerEnv } from "@/lib/config/env";

/** Échappement minimal pour insérer du texte utilisateur dans du HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type SegnaEmailShellOpts = {
  preheader: string;
  title: string;
  /** Paragraphes HTML déjà sûrs ou issus de `escapeHtml`. */
  bodyHtml: string;
};

/** Référence `cid:` dans le HTML ; pièce jointe inline ajoutée dans `sendTransactionalEmail`. */
export const SEGNA_EMAIL_LOGO_CONTENT_ID = "segnaEmailLogo";

/**
 * Origine HTTPS pour le lien sur le logo (app).
 * Priorité : `SEGNA_EMAIL_PUBLIC_BASE_URL` → `NEXT_PUBLIC_APP_URL` (si https) → `VERCEL_URL`.
 */
export function resolvePublicOriginForEmailImages(): string | null {
  const { SEGNA_EMAIL_PUBLIC_BASE_URL } = getServerEnv();
  const explicit = SEGNA_EMAIL_PUBLIC_BASE_URL?.trim();
  if (explicit && /^https:\/\//i.test(explicit)) return explicit.replace(/\/+$/, "");

  const app = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (app && /^https:\/\//i.test(app)) return app.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return null;
}

function buildEmailLogoHeaderHtml(): string {
  const origin = resolvePublicOriginForEmailImages();
  const img = `<img src="cid:${SEGNA_EMAIL_LOGO_CONTENT_ID}" width="140" alt="Segna" border="0" style="display:block;width:140px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />`;
  if (!origin) {
    return img;
  }
  const safeOrigin = escapeHtml(origin);
  return `<a href="${safeOrigin}/" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-block;line-height:0;">
  ${img}
</a>`;
}

/**
 * Mise en page e-mail transactionnelle sobre (tables + styles inline, compatible clients courants).
 */
export function segnaTransactionalEmailShell(opts: SegnaEmailShellOpts): string {
  const safeTitle = escapeHtml(opts.title);
  const safePre = escapeHtml(opts.preheader);
  const logoHeader = buildEmailLogoHeaderHtml();
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Georgia,'Times New Roman',serif;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${safePre}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#ffffff;border-radius:2px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:28px 28px 12px 28px;">
              ${logoHeader}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 24px 28px;font-size:22px;line-height:1.35;color:#18181b;font-weight:400;">
              ${safeTitle}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 32px 28px;font-size:16px;line-height:1.6;color:#3f3f46;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              ${opts.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px 28px;border-top:1px solid #f4f4f5;font-size:12px;line-height:1.5;color:#a1a1aa;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              Ce message est envoyé automatiquement suite à une action sur ton compte Segna.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function cartOrderPaidEmailBlocks(prenom: string, cartIdShort: string): { text: string; html: string } {
  const p = escapeHtml(prenom);
  const c = escapeHtml(cartIdShort);
  const text =
    `${prenom},\n\n` +
    `Ta commande a bien été enregistrée (panier ${cartIdShort}…).\n` +
    `Tu recevras un message lors des prochaines étapes (préparation / expédition).\n\n` +
    `L’équipe Segna`;
  const bodyHtml = `
    <p style="margin:0 0 16px;">Bonjour ${p},</p>
    <p style="margin:0 0 16px;">Ta commande a bien été <strong>enregistrée</strong>. Référence panier&nbsp;: <strong>${c}…</strong></p>
    <p style="margin:0 0 16px;">Tu recevras un e-mail lors des prochaines étapes (préparation, expédition).</p>
    <p style="margin:0;">Merci de ta confiance,<br /><span style="font-style:italic;">L’équipe Segna</span></p>`;
  const html = segnaTransactionalEmailShell({
    preheader: `Commande enregistrée — panier ${cartIdShort}…`,
    title: "Commande enregistrée",
    bodyHtml,
  });
  return { text, html };
}

export function walletCreditsEmailBlocks(prenom: string, creditsAmount: number): { text: string; html: string } {
  const p = escapeHtml(prenom);
  const n = escapeHtml(String(creditsAmount));
  const text =
    `${prenom},\n\n` +
    `Nous avons bien reçu ton paiement : ${creditsAmount} crédit(s) d’échange ont été ajoutés à ton compte.\n\n` +
    `Merci,\nL’équipe Segna`;
  const bodyHtml = `
    <p style="margin:0 0 16px;">Bonjour ${p},</p>
    <p style="margin:0 0 16px;">Nous avons bien reçu ton paiement.</p>
    <p style="margin:0 0 16px;"><strong>${n}</strong> crédit(s) d’échange ont été ajoutés à ton compte.</p>
    <p style="margin:0;">Merci,<br /><span style="font-style:italic;">L’équipe Segna</span></p>`;
  const html = segnaTransactionalEmailShell({
    preheader: `${creditsAmount} crédits d’échange ajoutés`,
    title: "Crédits d’échange",
    bodyHtml,
  });
  return { text, html };
}

export function segnaXWelcomeEmailBlocks(prenom: string): { text: string; html: string } {
  const p = escapeHtml(prenom);
  const text =
    `${prenom},\n\n` +
    `Bienvenue dans Segna X : tu bénéficies désormais de l’offre membre la plus complète (avantages, plafonds et accompagnement adaptés).\n\n` +
    `Retrouve les détails de ton abonnement dans l’app (profil / offre).\n\n` +
    `L’équipe Segna`;
  const bodyHtml = `
    <p style="margin:0 0 16px;">Bonjour ${p},</p>
    <p style="margin:0 0 16px;">Bienvenue dans <strong>Segna&nbsp;X</strong> : tu bénéficies désormais de notre offre membre la plus complète.</p>
    <p style="margin:0 0 16px;">Retrouve le détail de ton abonnement et tes avantages dans l’application (rubrique profil / offre).</p>
    <p style="margin:0;">À très vite,<br /><span style="font-style:italic;">L’équipe Segna</span></p>`;
  const html = segnaTransactionalEmailShell({
    preheader: "Bienvenue dans Segna X",
    title: "Bienvenue dans Segna X",
    bodyHtml,
  });
  return { text, html };
}
