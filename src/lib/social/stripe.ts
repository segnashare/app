type StripeConfig = {
  secretKey: string;
  returnUrlBase: string;
};

type StripeWebhookConfig = {
  secretKey: string;
  webhookSecret: string;
};

function getReturnUrlBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv && /^https?:\/\//.test(fromEnv)) return fromEnv.replace(/\/+$/, "");

  const fromVercel = process.env.VERCEL_URL?.trim();
  if (fromVercel) return `https://${fromVercel.replace(/\/+$/, "")}`;

  return "";
}

export function getStripeConfig(): StripeConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const returnUrlBase = getReturnUrlBase();

  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is missing.");
  if (!returnUrlBase) throw new Error("NEXT_PUBLIC_APP_URL or VERCEL_URL is missing.");

  return { secretKey, returnUrlBase };
}

export function getStripeWebhookConfig(): StripeWebhookConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";

  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is missing.");
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is missing.");

  return { secretKey, webhookSecret };
}
