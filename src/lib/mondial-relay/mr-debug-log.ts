/**
 * Logs serveur Mondial Relay (recherche relais, plan de tri, auto-génération étiquettes).
 *
 * - `MONDR_MR_DEBUG_LOG=1` : logs détaillés même en production (Vercel / API).
 * - `MONDR_MR_DEBUG_LOG=0` : désactive tout (y compris en dev).
 * - Absent : en dev → logs ; en production → pas de logs détaillés (sauf alertes ciblées ailleurs).
 */
export function isMondialRelayDebugLogEnabled(): boolean {
  const forcedOff = process.env.MONDR_MR_DEBUG_LOG === "0";
  const forcedOn = process.env.MONDR_MR_DEBUG_LOG === "1";
  if (forcedOff) return false;
  if (forcedOn) return true;
  return process.env.NODE_ENV !== "production";
}

export function mondialRelayDebugLog(tag: string, data: Record<string, unknown>): void {
  if (!isMondialRelayDebugLogEnabled()) return;
  console.log(`[mondial-relay:${tag}]`, data);
}
