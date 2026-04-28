-- pg_net : requêtes HTTP async (trigger → Edge Function item-intake-evaluation-webhook → n8n)
create extension if not exists pg_net;

comment on extension pg_net is
  'Requis pour envoyer le payload (format Database Webhook) vers l’Edge item-intake-evaluation-webhook.';
