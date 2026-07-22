/**
 * Ancienne Edge Function : relay `item_intake` → évaluation n8n.
 * Désactivée : le workflow n8n est réutilisé pour le chat pièce.
 * Le trigger DB `trg_item_intake_edge_evaluation_webhook` a été droppé.
 */
Deno.serve((_req: Request) => {
  return Response.json(
    {
      ok: false,
      error: "item_intake_evaluation_webhook_disabled",
      message: "Évaluation n8n désactivée. Utiliser N8N_ITEM_CHAT_WEBHOOK_URL pour le chat pièce.",
    },
    { status: 410 },
  );
});
