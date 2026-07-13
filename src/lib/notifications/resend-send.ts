import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { Resend } from "resend";

import { getServerEnv } from "@/lib/config/env";
import { SEGNA_EMAIL_LOGO_CONTENT_ID } from "@/lib/notifications/email-html";

let segnaEmailLogoBuffer: Buffer | undefined | null;

function segnaEmailLogoInlineAttachment():
  | { filename: string; content: Buffer; contentId: string; contentType: string }
  | undefined {
  if (segnaEmailLogoBuffer === null) return undefined;
  if (segnaEmailLogoBuffer) {
    return {
      filename: "segna_logo.svg",
      content: segnaEmailLogoBuffer,
      contentId: SEGNA_EMAIL_LOGO_CONTENT_ID,
      contentType: "image/svg+xml",
    };
  }
  const logoPath = join(process.cwd(), "public", "ressources", "segna_logo.svg");
  try {
    if (!existsSync(logoPath)) {
      console.error("[notifications] segna_logo.svg introuvable pour e-mail", { logoPath });
      segnaEmailLogoBuffer = null;
      return undefined;
    }
    segnaEmailLogoBuffer = readFileSync(logoPath);
    return {
      filename: "segna_logo.svg",
      content: segnaEmailLogoBuffer,
      contentId: SEGNA_EMAIL_LOGO_CONTENT_ID,
      contentType: "image/svg+xml",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] lecture segna_logo.svg échouée", msg);
    segnaEmailLogoBuffer = null;
    return undefined;
  }
}

export type TransactionalEmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
  contentId?: string;
};

/** @returns true si un envoi a été tenté avec succès auprès de Resend. */
export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  text: string;
  /** HTML optionnel (clients mail : prévoir toujours `text` en repli). */
  html?: string;
  idempotencyKey: string;
  attachments?: TransactionalEmailAttachment[];
}): Promise<boolean> {
  const { RESEND_API_KEY, RESEND_FROM_EMAIL } = getServerEnv();
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    console.info("[notifications] Resend désactivé (RESEND_API_KEY ou RESEND_FROM_EMAIL manquant).");
    return false;
  }

  const logoCid = `cid:${SEGNA_EMAIL_LOGO_CONTENT_ID}`;
  const needsLogo = Boolean(input.html?.includes(logoCid));
  const logoAttachment = needsLogo ? segnaEmailLogoInlineAttachment() : undefined;
  const extraAttachments = input.attachments ?? [];
  const attachments = [...extraAttachments, ...(logoAttachment ? [logoAttachment] : [])];

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send(
    {
      from: RESEND_FROM_EMAIL,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (error) {
    throw new Error(typeof error.message === "string" ? error.message : "Resend send failed");
  }
  return true;
}
