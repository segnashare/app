import { z } from "zod";

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_KEY: z.string().min(1),
});

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_DEMO_URL: z.url().optional(),
  SUPABASE_DEMO_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_DEMO_SECRET_KEY: z.string().min(1).optional(),
  /** Resend (e-mails transactionnels). Si absent, les envois e-mail sont ignorés. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Ex. `commandes@domain.tld` ou `Segna <commandes@domain.tld>`. */
  RESEND_FROM_EMAIL: z.string().min(3).optional(),
  /** Twilio (SMS). Si SID/token absents, les SMS sont ignorés. */
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  /** Base URL absolue pour assets e-mail (logo), ex. `https://app.segnashare.com`. */
  SEGNA_EMAIL_PUBLIC_BASE_URL: z.string().optional(),
  /** Optionnel : utiliser un Messaging Service (recommandé prod). */
  TWILIO_MESSAGING_SERVICE_SID: z.string().min(1).optional(),
  /** Expéditeur SMS E.164 si pas de Messaging Service. */
  TWILIO_FROM_NUMBER: z.string().min(1).optional(),
  /** Si `1`, les notifications en `email+phone` envoient aussi un SMS (alertes délai / retard). */
  SEGNA_NOTIFY_SMS_ALERTS: z.string().optional(),
  /** Route cron `GET /api/cron/*` : `Authorization: Bearer …` (prioritaire sur CRON_SECRET). */
  SEGNA_CRON_SECRET: z.string().optional(),
  /** Vercel Cron envoie `Authorization: Bearer $CRON_SECRET` si la variable est définie sur le projet. */
  CRON_SECRET: z.string().optional(),
  /** Webhooks internes `POST /api/internal/member-lifecycle/notify` (étapes pièce depuis n8n / backoffice). */
  SEGNA_INTERNAL_MEMBER_LIFECYCLE_SECRET: z.string().optional(),
  /** Optionnel : `POST /api/internal/shipment-lifecycle-notify` ; sinon réutilisation de `SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET`. */
  SEGNA_INTERNAL_SHIPMENT_LIFECYCLE_SECRET: z.string().optional(),
  /** Workflow n8n litiges panier (`POST` après `/api/cart/dispute/open`). */
  N8N_DISPUTE_WEBHOOK_URL: z.string().url().optional(),
  N8N_DISPUTE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Workflow n8n commande panier confirmée (`declareCartOrderToN8n`). */
  N8N_CART_ORDER_WEBHOOK_URL: z.string().url().optional(),
  N8N_CART_ORDER_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Workflow n8n signalement membre (`POST /api/member-feedback`). */
  N8N_MEMBER_FEEDBACK_WEBHOOK_URL: z.string().url().optional(),
  N8N_MEMBER_FEEDBACK_WEBHOOK_SECRET: z.string().min(1).optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema> & {
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

let cachedClientEnv: ClientEnv | null = null;
let cachedServerEnv: ServerEnv | null = null;

export function getClientEnv(): ClientEnv {
  if (cachedClientEnv) return cachedClientEnv;

  cachedClientEnv = clientEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  return cachedClientEnv;
}

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverEnvSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_DEMO_URL: process.env.SUPABASE_DEMO_URL,
    SUPABASE_DEMO_SERVICE_ROLE_KEY: process.env.SUPABASE_DEMO_SERVICE_ROLE_KEY,
    SUPABASE_DEMO_SECRET_KEY: process.env.SUPABASE_DEMO_SECRET_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID,
    TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
    SEGNA_EMAIL_PUBLIC_BASE_URL: process.env.SEGNA_EMAIL_PUBLIC_BASE_URL,
    SEGNA_NOTIFY_SMS_ALERTS: process.env.SEGNA_NOTIFY_SMS_ALERTS,
    SEGNA_CRON_SECRET: process.env.SEGNA_CRON_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    SEGNA_INTERNAL_MEMBER_LIFECYCLE_SECRET: process.env.SEGNA_INTERNAL_MEMBER_LIFECYCLE_SECRET,
    SEGNA_INTERNAL_SHIPMENT_LIFECYCLE_SECRET: process.env.SEGNA_INTERNAL_SHIPMENT_LIFECYCLE_SECRET,
    N8N_DISPUTE_WEBHOOK_URL: process.env.N8N_DISPUTE_WEBHOOK_URL,
    N8N_DISPUTE_WEBHOOK_SECRET: process.env.N8N_DISPUTE_WEBHOOK_SECRET,
    N8N_CART_ORDER_WEBHOOK_URL: process.env.N8N_CART_ORDER_WEBHOOK_URL,
    N8N_CART_ORDER_WEBHOOK_SECRET: process.env.N8N_CART_ORDER_WEBHOOK_SECRET,
    N8N_MEMBER_FEEDBACK_WEBHOOK_URL: process.env.N8N_MEMBER_FEEDBACK_WEBHOOK_URL,
    N8N_MEMBER_FEEDBACK_WEBHOOK_SECRET: process.env.N8N_MEMBER_FEEDBACK_WEBHOOK_SECRET,
  });

  cachedServerEnv = {
    ...parsed,
    SUPABASE_SERVICE_ROLE_KEY:
      parsed.SUPABASE_SERVICE_ROLE_KEY ?? parsed.SUPABASE_SECRET_KEY,
    SUPABASE_DEMO_SERVICE_ROLE_KEY:
      parsed.SUPABASE_DEMO_SERVICE_ROLE_KEY ?? parsed.SUPABASE_DEMO_SECRET_KEY,
  };

  return cachedServerEnv;
}

/** Bearer attendu sur `GET /api/cron/*` : `SEGNA_CRON_SECRET`, sinon `CRON_SECRET` (Vercel Cron). */
export function getCronRouteBearerSecret(): string {
  const e = getServerEnv();
  return (e.SEGNA_CRON_SECRET?.trim() || e.CRON_SECRET?.trim() || "");
}
