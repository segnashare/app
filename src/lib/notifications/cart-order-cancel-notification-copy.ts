/** Textes e-mail / SMS annulation commande (paiement € carte, sans crédits / complément legacy). */

export type CartOrderCancelNotifySource = "member" | "backoffice";

export function cartOrderCancelNotificationCopy(args: {
  source: CartOrderCancelNotifySource;
  hadStripePayment: boolean;
  feePct: number;
}): {
  subject: string;
  text: string;
  html: string;
  smsBody: string;
} {
  const { source, hadStripePayment, feePct } = args;

  const stripeRefundText = hadStripePayment
    ? `Le remboursement sur ton moyen de paiement est en cours, sous réserve d’une retenue de ${feePct} % au titre des frais d’annulation.`
    : null;
  const stripeRefundHtml = hadStripePayment
    ? `<p>Le remboursement sur ton moyen de paiement est <strong>en cours</strong>, sous réserve d’une retenue de <strong>${feePct} %</strong> au titre des frais d’annulation.</p>`
    : "";

  if (source === "member") {
    const smsBody = hadStripePayment
      ? `Segna : tu as bien annulé ta commande avant expédition. Remboursement sur ton moyen de paiement en cours (retenue ${feePct} % frais d’annulation).`
      : "Segna : tu as bien annulé ta commande avant expédition.";

    return {
      subject: "Ta commande Segna a bien été annulée",
      text: [
        "Bonjour,",
        "",
        "Tu as annulé ta commande Segna alors qu’elle était encore en préparation ou prête à l’expédition, avant prise en charge par le transporteur.",
        ...(stripeRefundText ? ["", stripeRefundText] : []),
        "",
        "L’équipe Segna",
      ].join("\n"),
      html: `<p>Bonjour,</p>
<p>Tu as <strong>annulé</strong> ta commande Segna alors qu’elle était encore <strong>en préparation ou prête à l’expédition</strong>, avant prise en charge par le transporteur.</p>
${stripeRefundHtml}
<p>L’équipe Segna</p>`,
      smsBody,
    };
  }

  const smsBody = hadStripePayment
    ? "Segna : ta commande en préparation a été annulée avant expédition. Remboursement sur ton moyen de paiement en cours. Toutes nos excuses pour la gêne."
    : "Segna : ta commande en préparation a été annulée avant expédition. Toutes nos excuses pour la gêne.";

  return {
    subject: "Annulation de ta commande Segna",
    text: [
      "Bonjour,",
      "",
      "Ta commande Segna a dû être annulée alors qu’elle était encore en préparation, avant expédition.",
      ...(stripeRefundText ? [stripeRefundText] : []),
      "",
      "Toutes nos excuses pour ce désagrément.",
      "",
      "L’équipe Segna",
    ].join("\n"),
    html: `<p>Bonjour,</p>
<p>Ta commande Segna a dû être <strong>annulée</strong> alors qu’elle était encore <strong>en préparation</strong>, avant expédition.</p>
${stripeRefundHtml}
<p>Toutes nos excuses pour ce désagrément.</p>
<p>L’équipe Segna</p>`,
    smsBody,
  };
}
