import {
  type BorrowOverdueChargeFailureReason,
  formatBorrowOverdueDailyChargeNoteLinesFr,
  formatBorrowOverdueDailySmsChargeClauseFr,
  formatBorrowOverdueEmailBodyLinesFr,
  formatBorrowOverdueEmailSettlementParagraphFr,
  formatBorrowOverdueEmailSubjectFr,
  formatBorrowOverdueEmailTierNoteLinesFr,
} from "@/lib/cart/format-borrow-overdue-copy";
import { escapeHtml, resolvePublicOriginForEmailImages, segnaTransactionalEmailShell } from "@/lib/notifications/email-html";
import type { BorrowReturnReminderPhase } from "@/lib/emprunt/borrow-return-reminder-buckets";
import {
  appendSmsAppLink,
  memberAppExchangeUrl,
} from "@/lib/notifications/member-app-links";

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

export type OrderOutboundReadyEmailInput = {
  firstName: string | null;
  orderRef: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
};

export function orderOutboundReadyEmail(
  input: OrderOutboundReadyEmailInput,
): { subject: string; text: string; html: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(input.firstName));
  const orderRefEsc = escapeHtml(input.orderRef);
  const trackingEsc = input.trackingNumber ? escapeHtml(input.trackingNumber) : null;
  const trackingUrlEsc = input.trackingUrl ? escapeHtml(input.trackingUrl) : null;
  const orderPageUrl = input.trackingUrl;
  const subject = "Commande prête à partir";

  const refLineText = input.orderRef ? `Commande ${input.orderRef}.` : null;
  const refLineHtml = input.orderRef ? `<strong>Commande ${orderRefEsc}</strong>.` : null;

  const suiviLineText = input.trackingNumber
    ? `Numéro de suivi : ${input.trackingNumber}.`
    : "Le numéro de suivi sera disponible dans l’app Segna.";
  const suiviLineHtml = trackingEsc
    ? `<strong>Numéro de suivi :</strong> ${trackingEsc}.`
    : "Le numéro de suivi sera disponible dans l’<strong>app Segna</strong>.";

  const linkText = orderPageUrl
    ? `Suivre l’expédition : ${orderPageUrl}`
    : "Retrouve le suivi dans l’app Segna.";
  const linkHtml = orderPageUrl
    ? `<a href="${trackingUrlEsc}" style="color:#000;text-decoration:underline;font-weight:600;">Suivre l’expédition</a>`
    : "Retrouve le suivi dans l’<strong>app Segna</strong>.";

  const paragraphs: { text: string; html: string }[] = [
    { text: `Bonjour ${firstNameOrBonjour(input.firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: "Ta commande a été préparée et est prête à être expédiée.",
      html: "Ta commande a été <strong>préparée</strong> et est <strong>prête à être expédiée</strong>.",
    },
  ];
  if (refLineText && refLineHtml) {
    paragraphs.push({ text: refLineText, html: refLineHtml });
  }
  paragraphs.push({ text: suiviLineText, html: suiviLineHtml });
  paragraphs.push({ text: linkText, html: linkHtml });
  paragraphs.push({
    text: "Tu recevras un nouveau message dès que le transport sera en cours.",
    html: "Tu recevras un nouveau message dès que le transport sera en cours.",
  });

  const { text, html } = shell(subject, "Ta commande est prête pour l’expédition", paragraphs);
  return { subject, text, html };
}

/** Aller : colis disponible au point relais pour retrait (`dropped_out`). */
export function orderOutboundRelayPickupAvailableEmail(firstName: string | null): { subject: string; text: string; html: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const subject = "Colis disponible au point relais";
  const { text, html } = shell(subject, "Tu peux retirer ton colis au point relais", [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: "Ton colis est disponible en point relais ! Détails et suivi sur le mail du partenaire d'expédition.",
      html: "Ton colis est <strong>disponible en point relais</strong> ! Détails et suivi sur le <strong>mail du partenaire d'expédition</strong>.",
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
    smsBody = appendSmsAppLink(
      `Segna : échéance de retour dépassée (${opts.cartLabel.trim().slice(0, 40)}).`,
      memberAppExchangeUrl(),
    );
  } else if (phase === "jj") {
    subject = "Retour d’emprunt : échéance aujourd’hui";
    bodyP2Text = `Aujourd’hui est le dernier jour pour respecter l’échéance de retour pour ${opts.cartLabel}. Pense à déposer ton colis retour depuis l’app si ce n’est pas déjà fait.`;
    bodyP2Html = `Aujourd’hui est le <strong>dernier jour</strong> pour respecter l’échéance de retour pour <strong>${labelEsc}</strong>. Pense à déposer ton colis retour depuis l’app si ce n’est pas déjà fait.`;
    smsBody = appendSmsAppLink(
      `Segna : dernier jour pour retourner (${opts.cartLabel.trim().slice(0, 40)}).`,
      memberAppExchangeUrl(),
    );
  } else {
    const days =
      phase === "jminus7" ? 7 : phase === "jminus3" ? 3 : 1;
    subject = `Retour d’emprunt : J-${days}`;
    bodyP2Text = `Il te reste environ ${days} jour(s) avant l’échéance de retour pour ${opts.cartLabel}. Pense à générer / déposer ton colis retour depuis l’app.`;
    bodyP2Html = `Il te reste environ <strong>${days}</strong> jour(s) avant l’échéance de retour pour <strong>${labelEsc}</strong>. Pense à générer / déposer ton colis retour depuis l’app.`;
    smsBody = appendSmsAppLink(
      `Segna : J-${days} avant retour (${opts.cartLabel.trim().slice(0, 40)}).`,
      memberAppExchangeUrl(),
    );
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

function formatPenaltyEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    Math.max(0, cents) / 100,
  );
}

export function borrowOverdueDailyEmail(
  firstName: string | null,
  opts: {
    cartLabel: string;
    lateDayIndex: number;
    penaltyCents: number;
    penaltyCredits: number;
    ratePercent: number;
    chargeStatus: string;
    chargeFailureReason?: BorrowOverdueChargeFailureReason;
    chargedViaStripe?: boolean;
    regulariserUrl?: string | null;
    profilePaymentUrl?: string | null;
  },
): { subject: string; text: string; html: string; smsBody: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const day = Math.max(1, Math.trunc(opts.lateDayIndex));
  const tierLines = formatBorrowOverdueEmailTierNoteLinesFr(day);
  const subject = formatBorrowOverdueEmailSubjectFr(day);

  const chargeNoteLines = formatBorrowOverdueDailyChargeNoteLinesFr({
    penaltyCents: opts.penaltyCents,
    lateDayIndex: day,
    ratePercent: opts.ratePercent,
    chargeStatus: opts.chargeStatus,
    chargeFailureReason: opts.chargeFailureReason,
  });

  const bodyLines = formatBorrowOverdueEmailBodyLinesFr({
    lateDayIndex: day,
    cartLabel: opts.cartLabel,
    chargeNoteLines,
    tierLines,
  });

  const settlementParagraph =
    opts.chargeStatus !== "charged" && !opts.chargedViaStripe
      ? formatBorrowOverdueEmailSettlementParagraphFr({
          regulariserUrl: opts.regulariserUrl,
          profilePaymentUrl: opts.profilePaymentUrl,
        })
      : null;

  const bodyParagraphs = bodyLines.map((line) => ({
    text: line,
    html: escapeHtml(line),
  }));

  const paragraphs = [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    ...bodyParagraphs,
    ...(settlementParagraph ? [settlementParagraph] : []),
    {
      text: "Retrouve tous les détails dans l'onglet Échange, emprunt en cours.",
      html: "Retrouve tous les détails dans l'onglet <strong>Échange</strong>, emprunt en cours.",
    },
  ];

  const { text, html } = shell(subject, subject, paragraphs);

  const chargeClause = formatBorrowOverdueDailySmsChargeClauseFr({
    chargeStatus: opts.chargeStatus,
    chargeFailureReason: opts.chargeFailureReason,
  });
  const smsLink =
    opts.regulariserUrl?.trim() ||
    opts.profilePaymentUrl?.trim() ||
    memberAppExchangeUrl();
  const smsBody = appendSmsAppLink(
    `Segna : retard retour J${day}, ${formatPenaltyEuros(opts.penaltyCents)} (${opts.cartLabel.trim().slice(0, 28)}). ${chargeClause}`,
    smsLink,
  );

  return { subject, text, html, smsBody };
}

function formatEurosNotice(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    Math.max(0, cents) / 100,
  );
}

export function borrowFormalNoticeSentEmail(
  firstName: string | null,
  opts: {
    orderRef: string;
    lateDayIndex: number;
    deadlineLabel: string;
    penaltiesAccruedCents: number;
    empruntUrl: string;
  },
): { subject: string; text: string; html: string; smsBody: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const orderRefEsc = escapeHtml(opts.orderRef);
  const day = Math.max(1, Math.trunc(opts.lateDayIndex));
  const subject = `Segna — mise en demeure (emprunt ${opts.orderRef})`;

  const paragraphs = [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: `Nous t'avons adressé une mise en demeure recommandée concernant ton emprunt ${opts.orderRef} (${day} jour${day > 1 ? "s" : ""} de retard).`,
      html: `Nous t'avons adressé une <strong>mise en demeure recommandée</strong> concernant ton emprunt <strong>${orderRefEsc}</strong> (${day} jour${day > 1 ? "s" : ""} de retard).`,
    },
    {
      text: `Tu disposes de 10 jours pour restituer ton colis, soit au plus tard le ${opts.deadlineLabel}. Frais de retard cumulés : ${formatEurosNotice(opts.penaltiesAccruedCents)}.`,
      html: `Tu disposes de <strong>10 jours</strong> pour restituer ton colis, soit au plus tard le <strong>${escapeHtml(opts.deadlineLabel)}</strong>. Frais de retard cumulés : <strong>${escapeHtml(formatEurosNotice(opts.penaltiesAccruedCents))}</strong>.`,
    },
    {
      text: "Consulte ta fiche emprunt pour déposer le colis ou nous contacter.",
      html: "Consulte ta <strong>fiche emprunt</strong> pour déposer le colis ou nous contacter.",
    },
  ];

  const { text, html } = shell(subject, subject, paragraphs);
  const smsBody = `Segna : mise en demeure envoyée (emprunt ${opts.orderRef}). Restitue avant le ${opts.deadlineLabel}.`;

  return { subject, text, html, smsBody };
}

export function borrowNonRestitutionInvoicedEmail(
  firstName: string | null,
  opts: {
    orderRef: string;
    cartValueCents: number;
    unpaidPenaltyCents: number;
    totalCents: number;
    hostedInvoiceUrl: string | null;
    empruntUrl: string;
  },
): { subject: string; text: string; html: string; smsBody: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const orderRefEsc = escapeHtml(opts.orderRef);
  const totalLabel = formatEurosNotice(opts.totalCents);
  const subject = `Segna — facture non-restitution (emprunt ${opts.orderRef})`;

  const invoiceLine = opts.hostedInvoiceUrl
    ? {
        text: `Consulte et règle ta facture : ${opts.hostedInvoiceUrl}`,
        html: `Consulte et règle ta facture : <a href="${escapeHtml(opts.hostedInvoiceUrl)}">lien sécurisé Stripe</a>.`,
      }
    : {
        text: "Consulte ta fiche emprunt pour le détail.",
        html: "Consulte ta <strong>fiche emprunt</strong> pour le détail.",
      };

  const penaltyLine =
    opts.unpaidPenaltyCents > 0
      ? {
          text: `valeur du panier ${formatEurosNotice(opts.cartValueCents)} + frais de retard non réglés ${formatEurosNotice(opts.unpaidPenaltyCents)}`,
          html: `valeur du panier <strong>${escapeHtml(formatEurosNotice(opts.cartValueCents))}</strong> + frais de retard non réglés <strong>${escapeHtml(formatEurosNotice(opts.unpaidPenaltyCents))}</strong>`,
        }
      : {
          text: `valeur du panier ${formatEurosNotice(opts.cartValueCents)}`,
          html: `valeur du panier <strong>${escapeHtml(formatEurosNotice(opts.cartValueCents))}</strong>`,
        };

  const paragraphs = [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: `Le délai de restitution de ton emprunt ${opts.orderRef} est dépassé. Une facture de ${totalLabel} a été émise (${penaltyLine.text}).`,
      html: `Le délai de restitution de ton emprunt <strong>${orderRefEsc}</strong> est dépassé. Une facture de <strong>${escapeHtml(totalLabel)}</strong> a été émise (${penaltyLine.html}).`,
    },
    invoiceLine,
    {
      text: "Tu peux encore déposer ton colis au relais ; en cas de retour après règlement, la valeur du panier pourra être remboursée selon nos conditions.",
      html: "Tu peux encore déposer ton colis au relais ; en cas de retour après règlement, la valeur du panier pourra être remboursée selon nos conditions.",
    },
  ];

  const { text, html } = shell(subject, subject, paragraphs);
  const smsBody = opts.hostedInvoiceUrl
    ? `Segna : facture non-restitution ${totalLabel} (emprunt ${opts.orderRef}). ${opts.hostedInvoiceUrl}`
    : `Segna : facture non-restitution ${totalLabel} (emprunt ${opts.orderRef}).`;

  return { subject, text, html, smsBody };
}
