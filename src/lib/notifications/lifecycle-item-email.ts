import { escapeHtml, segnaTransactionalEmailShell } from "@/lib/notifications/email-html";

function firstNameOrBonjour(firstName: string | null | undefined): string {
  const t = firstName?.trim();
  if (t) return t;
  return "Bonjour";
}

function shell(title: string, preheader: string, paragraphs: { text: string; html: string }[]): { text: string; html: string } {
  const text = paragraphs.map((p) => p.text).join("\n\n");
  const bodyHtml = paragraphs.map((p) => `<p style="margin:0 0 16px;">${p.html}</p>`).join("");
  return { text, html: segnaTransactionalEmailShell({ title, preheader, bodyHtml }) };
}

export function itemEvaluatedEmail(firstName: string | null, itemLabel: string): { subject: string; text: string; html: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const iEsc = escapeHtml(itemLabel);
  const subject = "Pièce évaluée";
  const { text, html } = shell(subject, "Ton annonce a été évaluée", [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: `Segna a terminé l'évaluation de « ${itemLabel} ».`,
      html: `Segna a terminé l’évaluation de <strong>${iEsc}</strong>.`,
    },
    {
      text: "Ouvre l’app pour voir le détail et la suite du parcours (validation prix, envoi, etc.).",
      html: "Ouvre l’app pour voir le détail et la suite du parcours (validation prix, envoi, etc.).",
    },
  ]);
  return { subject, text, html };
}

export function itemReceivedBySegnaEmail(firstName: string | null, itemLabel: string): { subject: string; text: string; html: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const iEsc = escapeHtml(itemLabel);
  const subject = "Pièce reçue par Segna";
  const { text, html } = shell(subject, "Réception logistique", [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: `Nous avons bien réceptionné « ${itemLabel} » dans nos locaux.`,
      html: `Nous avons bien <strong>réceptionné</strong> <strong>${iEsc}</strong> dans nos locaux.`,
    },
    {
      text: "La vérification peut prendre un peu de temps ; tu seras informée des prochaines étapes.",
      html: "La vérification peut prendre un peu de temps ; tu seras informée des prochaines étapes.",
    },
  ]);
  return { subject, text, html };
}

export function itemValidatedBySegnaEmail(firstName: string | null, itemLabel: string): { subject: string; text: string; html: string } {
  const pEsc = escapeHtml(firstNameOrBonjour(firstName));
  const iEsc = escapeHtml(itemLabel);
  const subject = "Pièce validée par Segna";
  const { text, html } = shell(subject, "Validation annonce", [
    { text: `Bonjour ${firstNameOrBonjour(firstName)},`, html: `Bonjour ${pEsc},` },
    {
      text: `« ${itemLabel} » est validée côté Segna.`,
      html: `<strong>${iEsc}</strong> est <strong>validée</strong> côté Segna.`,
    },
    {
      text: "Tu peux suivre la suite (mise en ligne, expédition…) depuis l’app.",
      html: "Tu peux suivre la suite (mise en ligne, expédition…) depuis l’app.",
    },
  ]);
  return { subject, text, html };
}
