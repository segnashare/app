import {
  ar24ApiPost,
  extractAr24MailProofUrl,
  getAr24Config,
  type Ar24Config,
} from "@/lib/ar24/client";

export { ar24CryptoSelfTest } from "@/lib/ar24/crypto";
export { ar24GetUserInfo, ar24RequestDate, getAr24Config, type Ar24Config } from "@/lib/ar24/client";

export type Ar24SendMailInput = {
  toEmail: string;
  toFirstname: string;
  toLastname: string;
  content: string;
  refDossier: string;
  refClient?: string;
  toAddress1?: string;
  toCity?: string;
  toPostalCode?: string;
  toCountry?: string;
};

export type Ar24SendMailResult = {
  ok: boolean;
  dryRun?: boolean;
  ar24MessageId?: string | null;
  ar24Status?: string | null;
  ar24ProofUrl?: string | null;
  raw?: unknown;
  error?: string;
};

export async function ar24SendRegisteredMail(
  config: Ar24Config,
  input: Ar24SendMailInput,
): Promise<Ar24SendMailResult> {
  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      ar24MessageId: `dry-run-${input.refDossier}`,
      ar24Status: "dry_run",
    };
  }

  const fields: Record<string, string | number> = {
    id_user: config.userId,
    eidas: 0,
    to_email: input.toEmail,
    to_firstname: input.toFirstname,
    to_lastname: input.toLastname,
    dest_statut: "particulier",
    content: input.content,
    ref_dossier: input.refDossier,
  };

  if (input.refClient) fields.ref_client = input.refClient;
  if (input.toAddress1) fields.to_address1 = input.toAddress1;
  if (input.toCity) fields.to_city = input.toCity;
  if (input.toPostalCode) fields.to_postal_code = input.toPostalCode;
  if (input.toCountry) fields.to_country = input.toCountry;
  if (config.paymentSlug) fields.payment_slug = config.paymentSlug;
  if (config.webhookUrl) fields.webhook = config.webhookUrl;

  const api = await ar24ApiPost(config, "/mail", fields);

  if (!api.ok) {
    return {
      ok: false,
      error: api.message ?? "ar24_send_failed",
      raw: api.raw,
    };
  }

  const mail = (api.result ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    ar24MessageId: mail.id != null ? String(mail.id) : null,
    ar24Status: typeof mail.status === "string" ? mail.status : api.status ?? null,
    ar24ProofUrl: extractAr24MailProofUrl(mail),
    raw: api.raw,
  };
}
