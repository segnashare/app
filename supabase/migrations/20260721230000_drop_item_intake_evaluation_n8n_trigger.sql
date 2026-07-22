-- Désactive le relay n8n évaluation pièce (Edge item-intake-evaluation-webhook).
-- Le workflow n8n associé est réutilisé pour le chat pièce ; plus de push auto à l'évaluation.

drop trigger if exists trg_item_intake_edge_evaluation_webhook on public.item_intake;

drop function if exists public._trg_notify_item_intake_edge_evaluation();
