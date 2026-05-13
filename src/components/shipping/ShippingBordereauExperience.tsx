"use client";

import Link from "next/link";
import { ChevronLeft, ExternalLink, LifeBuoy, Loader2, Store } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  mondialRelayLabelMatchesItemGroup,
  parseMondialRelayFromIntakeMetadata,
} from "@/lib/items/intake-shipping-metadata";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SEGNA_SECTION_TITLE_CLASSNAME, segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const playfair = segnaPlayfairDisplay;

/** Message API `member-mr-auto-generate` quand `users.adress` est incomplet. */
const PROFILE_ADDRESS_INCOMPLETE_HINT = "Complète ton adresse postale dans ton profil";

/** Même ordre de grandeur que le paiement panier (WSI3 recherche relais). */
const MR_RELAY_SEARCH_WEIGHT_G = 900;

function userFacingShippingRelaySearchError(status: number, raw?: string): string {
  const t = (raw ?? "").trim();
  if (status === 501 || /MONDR_RELAY|configuration transporteur|indisponible\s*:\s*configuration/i.test(t)) {
    return "Recherche indisponible pour le moment — réessaie plus tard.";
  }
  if (status === 401) return "Connecte-toi pour lancer une recherche.";
  if (status === 502 || status === 503) {
    return "Service relais injoignable — réessaie dans quelques instants.";
  }
  if (t) return t;
  return `Erreur ${status}`;
}

type ShippingRelayHit = { code: string; label: string; postalCode?: string; city?: string };

type ShippingRelaySearchPanelProps = {
  /** CP extrait de `users.adress` (5 chiffres) quand disponible. */
  defaultPostalCode?: string;
};

function ShippingRelaySearchPanel({ defaultPostalCode = "" }: ShippingRelaySearchPanelProps) {
  const [postal, setPostal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<ShippingRelayHit[]>([]);

  useEffect(() => {
    const pc = (defaultPostalCode ?? "").replace(/\D/g, "").slice(0, 5);
    if (pc.length !== 5) return;
    setPostal((prev) => (prev === "" ? pc : prev));
  }, [defaultPostalCode]);

  const searchRelays = useCallback(async () => {
    const pc = postal.replace(/\D/g, "").slice(0, 5);
    if (pc.length !== 5) {
      setError("Saisis un code postal à 5 chiffres.");
      setPoints([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/items/mondial-relay/relay-search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          postal_code: pc,
          country: "FR",
          weight_g: MR_RELAY_SEARCH_WEIGHT_G,
          action: "24R",
        }),
      });
      const j = (await res.json()) as {
        points?: Array<{ code: string; label: string; postalCode?: string; city?: string }>;
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        setError(userFacingShippingRelaySearchError(res.status, j.error));
        setPoints([]);
        return;
      }
      const raw = Array.isArray(j.points) ? j.points : [];
      const list: ShippingRelayHit[] = raw.map((p) => ({
        code: p.code,
        label: p.label,
        postalCode: p.postalCode ?? pc,
        city: p.city,
      }));
      setPoints(list);
      if (list.length === 0) {
        setError(j.hint ?? "Aucun point relais pour ce code postal.");
      }
    } catch {
      setError("Recherche impossible. Réessaie dans un instant.");
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [postal]);

  return (
    <section className="bg-white px-5 pb-6 pt-8">
      <h2 className={cn(playfair.className, SEGNA_SECTION_TITLE_CLASSNAME, "text-[20px]")}>Relais près de toi</h2>
      <div className="mt-3 flex items-start gap-3">
        <Store className="mt-0.5 h-5 w-5 shrink-0 text-zinc-700" aria-hidden />
        <div className="min-w-0">
          <p className={cn(montserrat.className, "text-[15px] font-semibold text-zinc-900")}>Mondial Relay</p>
          <p className={cn(montserrat.className, "mt-0.5 text-[13px] font-medium leading-snug text-zinc-600")}>
            Liste indicative autour d’un code postal (France).
          </p>
        </div>
      </div>

      <label className={cn(montserrat.className, "mt-5 block")}>
        <span className="text-[13px] font-medium text-zinc-600">Code postal</span>
        <div className="mt-1.5 flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={5}
            value={postal}
            onChange={(e) => setPostal(e.target.value.replace(/\D/g, "").slice(0, 5))}
            placeholder="ex. 75017"
            autoComplete="postal-code"
            className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2.5 text-[16px] text-zinc-900 outline-none focus:border-zinc-400"
          />
          <button
            type="button"
            onClick={() => void searchRelays()}
            disabled={loading}
            className={cn(
              montserrat.className,
              "shrink-0 rounded-xl bg-zinc-950 px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:bg-zinc-900 disabled:opacity-60",
            )}
          >
            {loading ? "…" : "Rechercher"}
          </button>
        </div>
      </label>
      {error ? <p className="mt-2 text-[13px] font-medium text-red-600">{error}</p> : null}
      {points.length > 0 ? (
        <ul className="mt-4 max-h-[260px] space-y-2 overflow-y-auto pr-0.5">
          {points.map((p) => (
            <li
              key={p.code}
              className="rounded-xl border border-zinc-200 bg-zinc-50/40 px-3 py-3"
            >
              <p className={cn(montserrat.className, "text-[15px] font-semibold leading-snug text-zinc-900")}>
                {p.label}
              </p>
              <p className={cn(montserrat.className, "mt-0.5 text-[13px] font-medium text-zinc-600")}>
                {[p.postalCode, p.city].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type IntakeSnap = {
  listing_stage: string | null;
  fulfillment_stage: string | null;
  metadata: unknown;
};

type LoadedRow = {
  id: string;
  title: string;
  intake: IntakeSnap | null;
};

export type ShippingBordereauExperienceProps = {
  /** Titre du header fixe. Si absent : titre de la première pièce chargée (parcours fiche). Pour le parcours transverse, passer p.ex. « Bordereau d'envoi ». */
  headerTitle?: string;
  /** Cible du bouton retour. */
  backHref: string;
  /** Libellé accessibilité du retour. */
  backLabel?: string;
  /** Une ou plusieurs pièces (même étiquette MR attendue si fusion BO). */
  itemIds: string[];
};

function pickMondialFromRows(rows: LoadedRow[], groupItemIds: string[]) {
  for (const row of rows) {
    const m = parseMondialRelayFromIntakeMetadata(row.intake?.metadata ?? null);
    if (m?.label_url && mondialRelayLabelMatchesItemGroup(groupItemIds, m)) return { mondial: m, intake: row.intake };
  }
  const firstIntake = rows[0]?.intake ?? null;
  const fallback = parseMondialRelayFromIntakeMetadata(firstIntake?.metadata ?? null);
  const mondial = mondialRelayLabelMatchesItemGroup(groupItemIds, fallback) ? fallback : null;
  return { mondial, intake: firstIntake };
}

export function ShippingBordereauExperience({
  headerTitle: headerTitleProp,
  backHref,
  backLabel = "Retour",
  itemIds,
}: ShippingBordereauExperienceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shippingReturnPath = useMemo(() => {
    const qs = searchParams.toString();
    if (!pathname) return qs ? `/items/shipping?${qs}` : "/items/shipping";
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  const profileLocationEditHref = useMemo(
    () => `/profile/edit?field=location&returnPath=${encodeURIComponent(shippingReturnPath)}`,
    [shippingReturnPath],
  );

  const [rows, setRows] = useState<LoadedRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const generationAbortRef = useRef<AbortController | null>(null);
  const [autoPhase, setAutoPhase] = useState<"idle" | "trying" | "done" | "failed" | "skipped">("idle");
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoDeveloperHint, setAutoDeveloperHint] = useState<string | null>(null);
  const [helpPhase, setHelpPhase] = useState<"idle" | "sending" | "sent" | "error">("idle");
  /** CP à 5 chiffres issu du profil (`users.adress`) pour préremplir la recherche relais. */
  const [profilePostalCode, setProfilePostalCode] = useState("");

  const itemIdsKey = itemIds.join(",");
  useEffect(() => {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    setAutoPhase("idle");
    setAutoError(null);
    setAutoDeveloperHint(null);
    setHelpPhase("idle");
  }, [itemIdsKey]);

  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(80);

  const fetchData = useCallback(async () => {
    if (itemIds.length === 0) {
      setIsLoading(false);
      setProfilePostalCode("");
      return;
    }
    setIsLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
    const supabase = createSupabaseBrowserClient() as any;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setProfilePostalCode("");
      setIsLoading(false);
      return;
    }

    const { data: profileRow } = await supabase.from("users").select("adress").eq("id", user.id).maybeSingle();
    const rawAdress =
      profileRow && typeof profileRow === "object" && "adress" in profileRow
        ? (profileRow as { adress?: string | null }).adress
        : null;
    const parsed = parseMemberAdressForShipment(typeof rawAdress === "string" ? rawAdress : null);
    const pcFromProfile = (parsed?.sender_postcode ?? "").replace(/\D/g, "").slice(0, 5);
    setProfilePostalCode(pcFromProfile.length === 5 ? pcFromProfile : "");

    const loaded: LoadedRow[] = [];
    for (const id of itemIds) {
      const { data: row } = await supabase
        .from("items")
        .select("id,title,item_intake(listing_stage,fulfillment_stage,metadata)")
        .eq("id", id)
        .eq("owner_user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!row) continue;
      const r = row as Record<string, unknown>;
      const rawIntake = r.item_intake as unknown;
      const emb = Array.isArray(rawIntake) ? rawIntake[0] : rawIntake;
      let intake: IntakeSnap | null = null;
      if (emb && typeof emb === "object") {
        const o = emb as Record<string, unknown>;
        intake = {
          listing_stage: typeof o.listing_stage === "string" ? o.listing_stage : null,
          fulfillment_stage: typeof o.fulfillment_stage === "string" ? o.fulfillment_stage : null,
          metadata: o.metadata ?? {},
        };
      }
      loaded.push({
        id: String(r.id ?? id),
        title: typeof r.title === "string" && r.title.trim() ? r.title.trim() : "Pièce",
        intake,
      });
    }
    setRows(loaded);
    setIsLoading(false);
  }, [itemIds]);

  const rowsRef = useRef<LoadedRow[]>([]);
  rowsRef.current = rows;

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const runGeneration = useCallback(
    async (signal?: AbortSignal) => {
      if (itemIds.length === 0) return;
      setAutoPhase("trying");
      setAutoError(null);
      setAutoDeveloperHint(null);
      try {
        const res = await fetch("/api/items/mondial-relay/auto-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ item_ids: itemIds }),
          signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          developer_hint?: string;
        };
        if (signal?.aborted) return;
        if (res.ok && data.ok) {
          setAutoPhase("done");
          setAutoDeveloperHint(null);
          setAutoError(null);
          await fetchData();
          return;
        }
        setAutoPhase("failed");
        setAutoError(typeof data.error === "string" ? data.error : "Génération impossible pour le moment.");
        setAutoDeveloperHint(typeof data.developer_hint === "string" ? data.developer_hint : null);
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setAutoPhase("failed");
        setAutoError("Génération impossible pour le moment.");
        setAutoDeveloperHint(null);
      }
    },
    [itemIds, fetchData],
  );

  const triggerManualGeneration = useCallback(() => {
    generationAbortRef.current?.abort();
    const ac = new AbortController();
    generationAbortRef.current = ac;
    void runGeneration(ac.signal);
  }, [runGeneration]);

  useEffect(() => {
    if (isLoading || itemIds.length === 0) return;
    const curRows = rowsRef.current;
    const { mondial: m0 } = pickMondialFromRows(curRows, itemIds);
    if (m0?.label_url?.trim()) {
      setAutoPhase("done");
      setAutoError(null);
      setAutoDeveloperHint(null);
      return;
    }
    const complete = curRows.length === itemIds.length && curRows.length > 0;
    const shippingReady =
      complete &&
      curRows.every(
        (r) =>
          r.intake?.listing_stage === "validated" &&
          String(r.intake?.fulfillment_stage ?? "").trim().toLowerCase() === "shipping",
      );
    if (!shippingReady) {
      setAutoPhase((prev) => (prev === "trying" || prev === "failed" ? prev : "skipped"));
      return;
    }

    const ac = new AbortController();
    generationAbortRef.current?.abort();
    generationAbortRef.current = ac;
    void runGeneration(ac.signal);
    return () => {
      ac.abort();
    };
  }, [isLoading, itemIds, fetchData, runGeneration]);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [headerTitleProp, rows]);

  const headerTitle = useMemo(() => {
    const t = headerTitleProp?.trim();
    if (t) return t;
    return rows[0]?.title ?? "Envoi";
  }, [headerTitleProp, rows]);

  const { mondial, intake } = useMemo(() => pickMondialFromRows(rows, itemIds), [rows, itemIds]);
  const inVerification = intake?.fulfillment_stage === "in_verification";

  const requestHelp = useCallback(async (message = "") => {
    setHelpPhase("sending");
    try {
      const res = await fetch("/api/items/mondial-relay/help-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ item_ids: itemIds, message }),
      });
      if (res.ok) {
        setHelpPhase("sent");
        await fetchData();
      } else {
        setHelpPhase("error");
      }
    } catch {
      setHelpPhase("error");
    }
  }, [itemIds, fetchData]);
  const plural = itemIds.length > 1;

  const labelUrl = mondial?.label_url?.trim() ?? "";
  const showPdfDock = Boolean(labelUrl);

  const pageSubtitle = useMemo(() => {
    if (isLoading) return "Chargement…";
    if (labelUrl) return "Imprime avant dépôt au relais.";
    if (inVerification) return "Colis reçu — vérification en cours.";
    if (autoPhase === "trying") return "Génération en cours…";
    if (autoPhase === "failed") return "Une action est nécessaire.";
    if (autoPhase === "skipped") return "Génère ton bordereau pour l’imprimer avant dépôt au relais.";
    return "Bordereau en préparation.";
  }, [isLoading, labelUrl, inVerification, autoPhase]);

  const prepareHint = useMemo(() => {
    if (isLoading) return "Chargement…";
    if (labelUrl) {
      if (plural && rows.length > 0) {
        return "Un seul colis pour toutes les pièces — imprime l’étiquette (bouton en bas), puis dépose au relais.";
      }
      return "Imprime l’étiquette depuis le bouton en bas de l’écran, puis dépose au relais.";
    }
    if (autoPhase === "trying") {
      return "Emballe ton colis en attendant la génération d’étiquette.";
    }
    if (autoPhase === "failed") {
      return "Corrige le point bloquant ci-dessous, puis relance la génération.";
    }
    if (plural && rows.length > 0) {
      return "Emballe ton colis en attendant la génération d’étiquette — toutes les pièces listées ci-dessus dans le même carton.";
    }
    return "Emballe ton colis en attendant la génération d’étiquette.";
  }, [isLoading, labelUrl, autoPhase, plural, rows.length]);

  const goBack = () => {
    if (backHref.startsWith("/")) {
      router.push(backHref);
    } else {
      router.back();
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-zinc-100">
      <header
        ref={headerRef}
        className="fixed left-1/2 top-0 z-[60] w-full max-w-[430px] -translate-x-1/2 border-b border-zinc-200 bg-white"
      >
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={goBack}
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900"
              aria-label={backLabel}
            >
              <ChevronLeft className="h-8 w-8" strokeWidth={2.25} />
            </button>
            <span className="h-12 w-12 shrink-0" aria-hidden />
          </div>
          <h1 className={cn("mt-5", playfair.className, SEGNA_SECTION_TITLE_CLASSNAME)}>{headerTitle}</h1>
          <p className={cn(montserrat.className, "mt-1.5 text-[17px] font-medium leading-snug text-zinc-600")}>
            {pageSubtitle}
          </p>
        </div>
      </header>

      <div
        className="mx-auto w-full max-w-[430px] shrink-0 bg-white"
        style={{ height: headerHeight }}
        aria-hidden
      />

      <div
        className={cn(
          "mx-auto flex w-full max-w-[430px] flex-1 flex-col space-y-[4.5px] pt-[4.5px]",
        )}
      >
        {plural && rows.length > 0 ? (
          <section className="bg-white px-5 pb-6 pt-8">
            <h2 className={cn(playfair.className, SEGNA_SECTION_TITLE_CLASSNAME, "text-[20px]")}>
              Dans cet envoi
            </h2>
            <ul className="mt-4 space-y-3">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/items/${encodeURIComponent(row.id)}`}
                    className={cn(
                      montserrat.className,
                      "text-[15px] font-semibold text-zinc-900 underline-offset-2 hover:underline",
                    )}
                  >
                    {row.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="bg-white px-5 pb-6 pt-8">
          <h2 className={cn(playfair.className, SEGNA_SECTION_TITLE_CLASSNAME, "text-[20px]")}>
            Prépare ton envoi
          </h2>
          <p className={cn(montserrat.className, "mt-2 text-[14px] font-medium leading-snug text-zinc-600")}>
            {prepareHint}
          </p>

          {labelUrl ? (
            <div className={cn(montserrat.className, "mt-6 space-y-4")}>
              <button
                type="button"
                onClick={() =>
                  void requestHelp(
                    "Demande de régénération du bordereau (PDF illisible, erreur à l’ouverture, ou besoin d’un nouveau fichier côté Segna).",
                  )
                }
                disabled={helpPhase === "sending" || helpPhase === "sent"}
                className="flex w-full items-center justify-center gap-2 text-center text-[14px] font-semibold text-zinc-900 underline underline-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
              >
                <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden />
                {helpPhase === "sending"
                  ? "Envoi…"
                  : helpPhase === "sent"
                    ? "Demande envoyée"
                    : "PDF illisible ? Contacter Segna"}
              </button>
              {helpPhase === "error" ? (
                <p className="text-center text-[13px] font-medium text-rose-600">Réessaie plus tard ou écris-nous.</p>
              ) : null}
              {helpPhase === "sent" ? (
                <p className="text-center text-[13px] font-medium text-zinc-500">L’équipe traite ta demande.</p>
              ) : null}
              {mondial?.numero_suivi ? (
                <div className="rounded-2xl border border-zinc-200/90 bg-zinc-50/80 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Suivi</p>
                  <p className="mt-1 font-mono text-[15px] font-semibold text-zinc-900">{mondial.numero_suivi}</p>
                  {mondial?.lien_suivi ? (
                    <a
                      href={mondial.lien_suivi}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[14px] font-semibold text-zinc-900 underline underline-offset-2"
                    >
                      Suivre le colis
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : null}
                </div>
              ) : mondial?.lien_suivi ? (
                <a
                  href={mondial.lien_suivi}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[14px] font-semibold text-zinc-900 underline underline-offset-2"
                >
                  Suivre le colis
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : null}
            </div>
          ) : autoPhase === "trying" ? (
            <div
              className={cn(
                montserrat.className,
                "mt-6 flex items-center gap-3 rounded-2xl border border-zinc-200/90 bg-zinc-50 px-4 py-3.5 text-[14px] font-medium text-zinc-800",
              )}
            >
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-zinc-900" aria-hidden />
              <p className="leading-snug">Génération du bordereau…</p>
            </div>
          ) : autoPhase === "failed" ? (
            <div className="mt-6 space-y-3">
              <p
                className={cn(
                  montserrat.className,
                  "rounded-2xl border border-rose-200/90 bg-rose-50 px-4 py-3 text-[14px] font-medium leading-snug text-rose-950",
                )}
              >
                {(() => {
                  const msg = autoError ?? "Génération impossible pour le moment.";
                  if (!msg.includes(PROFILE_ADDRESS_INCOMPLETE_HINT)) return msg;
                  return (
                    <>
                      Complète ton adresse dans{" "}
                      <Link
                        href={profileLocationEditHref}
                        className="font-semibold text-rose-950 underline decoration-rose-400/80 underline-offset-2 hover:decoration-rose-700"
                      >
                        ton profil
                      </Link>
                      .
                    </>
                  );
                })()}
              </p>
              {autoDeveloperHint ? (
                <div
                  className={cn(
                    montserrat.className,
                    "rounded-2xl border border-zinc-200/90 bg-zinc-100/80 px-3 py-2 text-[11px] leading-relaxed text-zinc-600",
                  )}
                >
                  <span className="font-semibold text-zinc-800">Tech : </span>
                  {autoDeveloperHint}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setHelpPhase("idle");
                  setAutoDeveloperHint(null);
                  triggerManualGeneration();
                }}
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900",
                )}
              >
                Réessayer
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={triggerManualGeneration}
                disabled={isLoading || itemIds.length === 0 || inVerification}
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                Générer le bordereau
              </button>
              {inVerification ? (
                <p className={cn(montserrat.className, "text-center text-[13px] font-medium text-zinc-500")}>
                  Le bordereau sera proposé après la vérification de ton colis par Segna.
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void fetchData()}
                disabled={isLoading}
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-900 disabled:opacity-50",
                )}
              >
                Actualiser
              </button>
            </div>
          )}

          {isLoading ? (
            <p className={cn(montserrat.className, "mt-4 text-[13px] font-medium text-zinc-500")}>Chargement…</p>
          ) : null}
        </section>

        <ShippingRelaySearchPanel defaultPostalCode={profilePostalCode} />

        <section
          className={cn(
            "flex min-h-0 flex-1 flex-col bg-white px-5 pt-8",
            showPdfDock
              ? "pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))]"
              : "pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]",
          )}
        >
          <h2 className={cn(playfair.className, SEGNA_SECTION_TITLE_CLASSNAME, "text-[20px]")}>
            Mutualiser tes envois
          </h2>
          <p className={cn(montserrat.className, "mt-2 text-[14px] font-medium leading-snug text-zinc-600")}>
            Tu prépares plusieurs prêts ? Depuis l’échange, tu peux suivre tes pièces en cours et regrouper les envois
            lorsque la logistique le permet.
          </p>
          <Link
            href="/exchange"
            className={cn(
              montserrat.className,
              "mt-4 inline-flex text-[15px] font-semibold text-zinc-900 underline underline-offset-2 decoration-zinc-400 hover:decoration-zinc-900",
            )}
          >
            Nouvel échange
          </Link>
          <div className="min-h-0 flex-1" aria-hidden />
        </section>
      </div>

      {showPdfDock ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
          <div className="pointer-events-auto w-full max-w-[430px] border-t border-zinc-200 bg-white shadow-[0_-12px_32px_rgba(0,0,0,0.06)] pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-3">
            <div className="px-4">
              <a
                href={labelUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition active:bg-zinc-800",
                )}
              >
                Ouvrir le bordereau (PDF)
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
