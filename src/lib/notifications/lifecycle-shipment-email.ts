import { escapeHtml, resolvePublicOriginForEmailImages, segnaTransactionalEmailShell } from "@/lib/notifications/email-html";
import type { BorrowReturnReminderPhase } from "@/lib/emprunt/borrow-return-reminder-buckets";

function firstNameOrBonjour(firstName: string | null | undefined): string {
  const t = firstName?.trim();
  if (t) return t;
  return "Bonjour";
}

function shell(
  title: string,
  preheader: string,
  paragraphs: { text: string; html: string }[],
): { text: string; html: string } {
  const text = paragraphs.map((p) => p.text).join("\n\n");
  const bodyHtml = paragraphs.map((p) => `<p style="margin:0 0 16px;">${p.html}</p>`).join("");
  return {
    text,
    html: segnaTransactionalEmailShell({ title, preheader, bodyHtml }),
  };
}

export function orderOutboundReadyEmail(firstName: string | null): { subject: string; text: string; html: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const subject = "Commande prête à partir";
  const { text, html } = shell(subject, "Ta commande est prête pour l’expédition", [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: "Ta commande a été préparée et est prête à être expédiée.",
      html: "Ta commande a été <strong>préparée</strong> et est <strong>prête à être expédiée</strong>.",
    },
    {
      text: "Tu recevras un nouveau message dès que le transport sera en cours.",
      html: "Tu recevras un nouveau message dès que le transport sera en cours.",
    },
  ]);
  return { subject, text, html };
}

/** Aller : colis disponible au point relais pour retrait (`dropped_out`). */
export function orderOutboundRelayPickupAvailableEmail(firstName: string | null): { subject: string; text: string; html: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const subject = "Colis disponible au point relais";
  const { text, html } = shell(subject, "Tu peux retirer ton colis au point relais", [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: "Ton colis est disponible pour retrait au point relais. Ouvre l’app Segna pour le suivi, le lien partenaire (ex. Mondial Relay) et les consignes de retrait.",
      html: "Ton colis est <strong>disponible pour retrait</strong> au point relais. Ouvre l’app Segna pour le suivi, le <strong>lien partenaire</strong> (ex. Mondial Relay) et les consignes de retrait.",
    },
  ]);
  return { subject, text, html };
}

export type OrderOutboundDeliveredEmailInput = {
  firstName: string | null;
  cartId: string;
  orderRef: string;
  itemLabels: string[];
  borrowPeriodLabel: string;
  returnDeadlineLabel: string;
  supportEmail: string;
};

/** URL page commande membre (`/commande/[id]`) pour e-mails transactionnels. */
export function buildMemberCartOrderPageUrl(cartId: string): string | null {
  const origin = resolvePublicOriginForEmailImages();
  if (!origin || !cartId.trim()) return null;
  return `${origin}/commande/${cartId.trim()}`;
}

export function orderOutboundDeliveredEmail(
  input: OrderOutboundDeliveredEmailInput,
): { subject: string; text: string; html: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(input.firstName));
  const orderRefEsc = escapeHtml(input.orderRef);
  const borrowEsc = escapeHtml(input.borrowPeriodLabel);
  const deadlineEsc = escapeHtml(input.returnDeadlineLabel);
  const supportEsc = escapeHtml(input.supportEmail);
  const orderUrl = buildMemberCartOrderPageUrl(input.cartId);
  const orderUrlEsc = orderUrl ? escapeHtml(orderUrl) : null;

  const itemsText =
    input.itemLabels.length > 0
      ? input.itemLabels.map((l) => `• ${l}`).join("\n")
      : "• (détail dans l’app Segna)";
  const itemsHtml =
    input.itemLabels.length > 0
      ? `<ul style="margin:0 0 16px;padding-left:20px;">${input.itemLabels
          .map((l) => `<li>${escapeHtml(l)}</li>`)
          .join("")}</ul>`
      : "<p style=\"margin:0 0 16px;\">Détail des pièces dans l’app Segna.</p>";

  const subject = "Ta box Segna est livrée, récap de ton échange";
  const orderLinkText = orderUrl
    ? `Voir ma commande : ${orderUrl}`
    : "Retrouve le détail de ta commande dans l’app Segna.";
  const orderLinkHtml = orderUrl
    ? `<a href="${orderUrlEsc}" style="color:#000;text-decoration:underline;font-weight:600;">Voir ma commande</a>`
    : "Retrouve le détail de ta commande dans l’<strong>app Segna</strong>.";

  const { text, html } = shell(subject, "Récapitulatif de ton échange et date limite de retour", [
    { text: `Bonjour ${firstNameOrBonjour(input.firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: "Ton colis est indiqué comme livré. Voici le récapitulatif de ton échange :",
      html: "Ton colis est indiqué comme <strong>livré</strong>. Voici le <strong>récapitulatif</strong> de ton échange :",
    },
    {
      text: `Commande ${input.orderRef}\n${itemsText}`,
      html: `<p style="margin:0 0 8px;"><strong>Commande ${orderRefEsc}</strong></p>${itemsHtml}`,
    },
    {
      text: orderLinkText,
      html: `<p style="margin:0 0 16px;">${orderLinkHtml}</p>`,
    },
    {
      text: `Durée de location : ${input.borrowPeriodLabel}.`,
      html: `<strong>Durée de location :</strong> ${borrowEsc}.`,
    },
    {
      text: `Date limite de retour : ${input.returnDeadlineLabel}.`,
      html: `<strong>Date limite de retour :</strong> ${deadlineEsc}.`,
    },
    {
      text: "Pense à déclarer dans l’app Segna le moindre problème (colis, contenu, état des pièces).",
      html: "Pense à <strong>déclarer dans l’app Segna</strong> le moindre problème (colis, contenu, état des pièces).",
    },
    {
      text: `Si tu as besoin d’aide, écris-nous à ${input.supportEmail}.`,
      html: `Si tu as besoin d’aide, écris-nous à <a href="mailto:${supportEsc}" style="color:#000;text-decoration:underline;">${supportEsc}</a>.`,
    },
    {
      text: "Bonne location et profite bien de ta box !",
      html: "Bonne location et <strong>profite bien de ta box</strong> !",
    },
  ]);
  return { subject, text, html };
}

export function returnDroppedOutEmail(firstName: string | null): { subject: string; text: string; html: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const subject = "Retour : colis déposé";
  const { text, html } = shell(subject, "Dépôt retour enregistré", [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: "Nous avons enregistré le dépôt de ton colis retour au point relais.",
      html: "Nous avons enregistré le <strong>dépôt de ton colis retour</strong> au point relais.",
    },
    {
      text: "Tu seras informée de la suite (transport, réception chez Segna) par e-mail.",
      html: "Tu seras informée de la suite (transport, réception chez Segna) par e-mail.",
    },
  ]);
  return { subject, text, html };
}

export function returnReceivedBySegnaEmail(firstName: string | null): { subject: string; text: string; html: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const subject = "Retour reçu par Segna";
  const { text, html } = shell(subject, "Retour réceptionné", [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: "Ton retour a été réceptionné par Segna.",
      html: "Ton <strong>retour a été réceptionné</strong> par Segna. La vérification peut prendre un peu de temps.",
    },
    {
      text: "Tu recevras un message lorsque le traitement sera terminé.",
      html: "Tu recevras un message lorsque le traitement sera terminé.",
    },
  ]);
  return { subject, text, html };
}

export function borrowDeadlineReminderEmail(
  firstName: string | null,
  opts: { cartLabel: string; phase: BorrowReturnReminderPhase },
): { subject: string; text: string; html: string; smsBody: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const labelEsc = escapeHtml(opts.cartLabel);
  const phase = opts.phase;

  let subject: string;
  let bodyP2Text: string;
  let bodyP2Html: string;
  let smsBody: string;

  if (phase === "overdue") {
    subject = "Retour d’emprunt : échéance dépassée";
    bodyP2Text = `L’échéance de retour pour ${opts.cartLabel} est dépassée. Merci d’expédier ton retour ou de contacter le support.`;
    bodyP2Html = `L’échéance de retour pour <strong>${labelEsc}</strong> est <strong>dépassée</strong>. Merci d’expédier ton retour ou de contacter le support si besoin.`;
    smsBody = `Segna : échéance de retour dépassée (${opts.cartLabel.trim().slice(0, 40)}). Ouvre l’app.`;
  } else if (phase === "jj") {
    subject = "Retour d’emprunt : échéance aujourd’hui";
    bodyP2Text = `Aujourd’hui est le dernier jour pour respecter l’échéance de retour pour ${opts.cartLabel}. Pense à déposer ton colis retour depuis l’app si ce n’est pas déjà fait.`;
    bodyP2Html = `Aujourd’hui est le <strong>dernier jour</strong> pour respecter l’échéance de retour pour <strong>${labelEsc}</strong>. Pense à déposer ton colis retour depuis l’app si ce n’est pas déjà fait.`;
    smsBody = `Segna : dernier jour pour retourner (${opts.cartLabel.trim().slice(0, 40)}). Voir l’app Échange.`;
  } else {
    const days =
      phase === "jminus7" ? 7 : phase === "jminus3" ? 3 : 1;
    subject = `Retour d’emprunt : J-${days}`;
    bodyP2Text = `Il te reste environ ${days} jour(s) avant l’échéance de retour pour ${opts.cartLabel}. Pense à générer / déposer ton colis retour depuis l’app.`;
    bodyP2Html = `Il te reste environ <strong>${days}</strong> jour(s) avant l’échéance de retour pour <strong>${labelEsc}</strong>. Pense à générer / déposer ton colis retour depuis l’app.`;
    smsBody = `Segna : J-${days} avant retour (${opts.cartLabel.trim().slice(0, 40)}). Voir l’app Échange.`;
  }

  const { text, html } = shell(subject, subject, [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    { text: bodyP2Text, html: bodyP2Html },
    {
      text: "Détail et étiquette : rubrique Échange ou fiche commande / emprunt.",
      html: "Détail et étiquette : rubrique <strong>Échange</strong> ou fiche commande / emprunt.",
    },
  ]);
  return { subject, text, html, smsBody };
}
