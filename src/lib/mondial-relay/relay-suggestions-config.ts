export type RelayPoint = { code: string; label: string; postalCode?: string };

function parseRelayRows(raw: string | undefined): RelayPoint[] {
  const t = raw?.trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: RelayPoint[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const code = String((row as { code?: string }).code ?? "").trim();
      if (!code) continue;
      const label = String((row as { label?: string }).label ?? "").trim();
      const postalCode = (row as { postalCode?: string }).postalCode;
      out.push({
        code,
        label: label || code,
        ...(postalCode?.trim() ? { postalCode: postalCode.trim() } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function loadRelaySuggestionsFromEnv(): RelayPoint[] {
  return parseRelayRows(process.env.MONDR_RELAY_SUGGESTIONS_JSON);
}

/** Ordre du tableau = priorité (1er = défaut si disponible après filtre). */
export function loadRelayPreferredFromEnv(): RelayPoint[] {
  return parseRelayRows(process.env.MONDR_RELAY_PREFERRED_JSON);
}

/**
 * Préférés en tête, puis suggestions hors doublons. Enrichit label depuis suggestions si manquant.
 */
export function mergePreferredAndSuggestions(preferred: RelayPoint[], suggestions: RelayPoint[]): RelayPoint[] {
  const seen = new Set<string>();
  const out: RelayPoint[] = [];
  const sugByCode = new Map(suggestions.map((s) => [s.code, s]));

  for (const p of preferred) {
    if (seen.has(p.code)) continue;
    seen.add(p.code);
    const enrich = sugByCode.get(p.code);
    const pc = p.postalCode?.trim() || enrich?.postalCode?.trim();
    out.push({
      code: p.code,
      label: (p.label || enrich?.label || p.code).trim() || p.code,
      ...(pc ? { postalCode: pc } : {}),
    });
  }

  for (const s of suggestions) {
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    out.push({
      code: s.code,
      label: s.label || s.code,
      ...(s.postalCode?.trim() ? { postalCode: s.postalCode.trim() } : {}),
    });
  }

  return out;
}

/** Filtre CP identique au route handler historique. */
export function filterRelayPointsByPostalCode(points: RelayPoint[], postalCode: string | null): RelayPoint[] {
  const cp = postalCode?.trim();
  if (!cp || !/^\d{5}$/.test(cp)) return points;
  if (!points.some((p) => p.postalCode != null)) return points;
  return points.filter((p) => !p.postalCode || p.postalCode === cp);
}

/** Premier relais préféré (ordre inchangé) présent dans la liste filtrée. */
export function pickDefaultPreferredRelay(preferred: RelayPoint[], filteredPoints: RelayPoint[]): RelayPoint | null {
  if (preferred.length === 0) return null;
  const byCode = new Map(filteredPoints.map((p) => [p.code, p]));
  for (const p of preferred) {
    const hit = byCode.get(p.code);
    if (hit) return hit;
  }
  return null;
}

export type RelaySuggestionsPayload = {
  points: RelayPoint[];
  defaultRelay: { code: string; label: string } | null;
  hint?: string;
};

export function buildRelaySuggestionsPayload(postalCodeParam: string | null): RelaySuggestionsPayload {
  const preferred = loadRelayPreferredFromEnv();
  const suggestions = loadRelaySuggestionsFromEnv();
  const merged = mergePreferredAndSuggestions(preferred, suggestions);
  const filtered = filterRelayPointsByPostalCode(merged, postalCodeParam);
  const defaultRelay = pickDefaultPreferredRelay(preferred, filtered);
  const hint =
    filtered.length === 0
      ? preferred.length === 0 && suggestions.length === 0
        ? "Aucune suggestion : renseigner MONDR_RELAY_PREFERRED_JSON et/ou MONDR_RELAY_SUGGESTIONS_JSON dans .env.local, ou saisir le code FR-… manuellement jusqu'à l'API MR."
        : "Aucun point ne correspond au filtre CP : élargir le code postal, retirer le filtre ou compléter la liste préférée / suggestions."
      : undefined;

  return {
    points: filtered,
    defaultRelay: defaultRelay ? { code: defaultRelay.code, label: defaultRelay.label } : null,
    hint,
  };
}
