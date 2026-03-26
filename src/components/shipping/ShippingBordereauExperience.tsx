"use client";

import Link from "next/link";
import { Montserrat, Playfair_Display } from "next/font/google";
import { ChevronDown, ChevronLeft, ExternalLink, LifeBuoy, Loader2, Package } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  mondialRelayLabelMatchesItemGroup,
  parseMondialRelayFromIntakeMetadata,
} from "@/lib/items/intake-shipping-metadata";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: ["500", "600"] });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["700"] });

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
  const [rows, setRows] = useState<LoadedRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [autoAttemptId, setAutoAttemptId] = useState(0);
  const [autoPhase, setAutoPhase] = useState<"idle" | "trying" | "done" | "failed" | "skipped">("idle");
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoDeveloperHint, setAutoDeveloperHint] = useState<string | null>(null);
  const [helpPhase, setHelpPhase] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const itemIdsKey = itemIds.join(",");
  useEffect(() => {
    setAutoPhase("idle");
    setAutoAttemptId(0);
    setAutoError(null);
    setAutoDeveloperHint(null);
    setHelpPhase("idle");
    setShowAdvanced(false);
  }, [itemIdsKey]);

  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(80);

  const fetchData = useCallback(async () => {
    if (itemIds.length === 0) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
    const supabase = createSupabaseBrowserClient() as any;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsLoading(false);
      return;
    }

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
          (r.intake?.fulfillment_stage === "shipping" || r.intake?.fulfillment_stage === ""),
      );
    if (!shippingReady) {
      setAutoPhase("skipped");
      return;
    }

    let cancelled = false;
    setAutoPhase("trying");
    setAutoError(null);
    setAutoDeveloperHint(null);
    void (async () => {
      const res = await fetch("/api/items/mondial-relay/auto-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ item_ids: itemIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        developer_hint?: string;
      };
      if (cancelled) return;
      if (res.ok && data.ok) {
        setAutoPhase("done");
        setAutoDeveloperHint(null);
        await fetchData();
        return;
      }
      setAutoPhase("failed");
      setAutoError(typeof data.error === "string" ? data.error : "Génération impossible pour le moment.");
      setAutoDeveloperHint(typeof data.developer_hint === "string" ? data.developer_hint : null);
      setShowAdvanced(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, itemIds, autoAttemptId, fetchData]);

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
  const mainHeading = plural ? "Prépare l'envoi de tes pièces" : "Prépare l'envoi de ta pièce";
  const intro = plural
    ? "Utilise cette page pour récupérer ton bordereau unique et suivre ton colis vers Segna."
    : "Utilise cette page pour récupérer ton bordereau et suivre ton colis.";

  const goBack = () => {
    if (backHref.startsWith("/")) {
      router.push(backHref);
    } else {
      router.back();
    }
  };

  return (
    <main className="min-h-[100dvh] bg-white pb-10">
      <header ref={headerRef} className="fixed left-0 right-0 top-0 z-[60] border-b border-zinc-200 bg-white px-4 py-5">
        <div className="relative mx-auto flex max-w-[460px] items-center justify-center">
          <button
            type="button"
            onClick={goBack}
            className="absolute left-0 top-1/2 -translate-y-1/2 p-1"
            aria-label={backLabel}
          >
            <ChevronLeft className="h-6 w-6 text-zinc-700" />
          </button>
          <h1 className={cn(playfair.className, "px-10 text-center text-[20px] text-zinc-900")}>{headerTitle}</h1>
        </div>
      </header>

      <div className="relative z-0 mx-auto max-w-[460px] px-4" style={{ paddingTop: headerHeight + 16 }}>
        {plural && rows.length > 0 ? (
          <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50/90 p-3">
            <p className={cn(montserrat.className, "text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500")}>
              Pièces dans cet envoi ({rows.length})
            </p>
            <ul className="mt-2 space-y-2">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/items/${encodeURIComponent(row.id)}`}
                    className={cn(montserrat.className, "text-[14px] font-semibold text-[#5E3023] underline-offset-2 hover:underline")}
                  >
                    {row.title}
                  </Link>
                  <span className="mt-0.5 block font-mono text-[10px] text-zinc-500">{row.id}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <p className={cn(montserrat.className, "text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500")}>
            Prochaine étape
          </p>
          <h2 className={cn(playfair.className, "mt-1 text-[32px] leading-[1.08] text-zinc-900 sm:text-[36px]")}>
            {mainHeading}
          </h2>
          <p className={cn(montserrat.className, "mt-3 text-[14px] leading-relaxed text-zinc-700")}>{intro}</p>

          <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-zinc-600" />
              <p className={cn(montserrat.className, "text-[14px] font-semibold text-zinc-900")}>Consignes d&apos;envoi</p>
            </div>
            <p className={cn(montserrat.className, "mt-2 text-[13px] leading-relaxed text-zinc-600")}>
              {plural
                ? "Emballe toutes les pièces dans un seul colis et utilise le bordereau dès qu’il est disponible."
                : "Emballe soigneusement la pièce et utilise le bordereau dès qu’il est disponible."}
            </p>
          </div>

          {mondial?.label_url ? (
            <div className="mt-4 space-y-2">
              <a
                href={mondial.label_url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  montserrat.className,
                  "flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#5E3023] px-6 text-[15px] font-semibold text-white",
                )}
              >
                Ouvrir le bordereau (PDF)
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
              <button
                type="button"
                onClick={() =>
                  void requestHelp(
                    "Demande de régénération du bordereau (PDF illisible, erreur à l’ouverture, ou besoin d’un nouveau fichier côté Segna).",
                  )
                }
                disabled={helpPhase === "sending" || helpPhase === "sent"}
                className={cn(
                  montserrat.className,
                  "flex w-full items-center justify-center gap-2 text-center text-[13px] font-semibold text-[#5E3023] underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60",
                )}
              >
                <LifeBuoy className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {helpPhase === "sending"
                  ? "Envoi de la demande…"
                  : helpPhase === "sent"
                    ? "Demande envoyée à Segna"
                    : "Besoin d’aide ? Demander un nouveau bordereau (équipe Segna)"}
              </button>
              {helpPhase === "error" ? (
                <p className={cn(montserrat.className, "text-center text-[12px] text-rose-700")}>
                  Envoi impossible pour le moment. Écris-nous depuis l’app ou par email.
                </p>
              ) : null}
              {helpPhase === "sent" ? (
                <p className={cn(montserrat.className, "text-center text-[12px] text-zinc-600")}>
                  L’équipe voit ta demande dans le back-office et peut régénérer l’étiquette. Reviens sur cette page plus tard.
                </p>
              ) : null}
              <p className={cn(montserrat.className, "text-center text-[11px] leading-relaxed text-zinc-500")}>
                Un seul bordereau valide à la fois : utilise toujours celui affiché ici. Si Segna t’en envoie un nouveau,
                n’utilise plus l’ancien (PDF ou lien) pour éviter erreur au relais ou frais inutiles côté transporteur.
              </p>
            </div>
          ) : autoPhase === "trying" ? (
            <div
              className={cn(
                montserrat.className,
                "mt-4 flex items-center gap-3 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-3 text-[14px] text-amber-950",
              )}
            >
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#5E3023]" aria-hidden />
              <p className="leading-snug">
                Création automatique : recherche des relais près de ton code postal, puis essai successif sur la liste (comme
                « tous les relais » côté Segna)…
              </p>
            </div>
          ) : autoPhase === "failed" ? (
            <div className="mt-4 space-y-3">
              <p
                className={cn(
                  montserrat.className,
                  "rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] leading-relaxed text-rose-950",
                )}
              >
                {autoError ?? "La génération automatique n’a pas abouti."}
              </p>
              {autoDeveloperHint ? (
                <div
                  className={cn(
                    montserrat.className,
                    "rounded-xl border border-zinc-200 bg-zinc-100/80 px-3 py-2 text-[11px] leading-relaxed text-zinc-700",
                  )}
                >
                  <p className="font-semibold text-zinc-800">Pour les devs / infra</p>
                  <p className="mt-1">{autoDeveloperHint}</p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setHelpPhase("idle");
                  setAutoDeveloperHint(null);
                  setAutoAttemptId((n) => n + 1);
                }}
                className={cn(
                  montserrat.className,
                  "w-full rounded-full border border-zinc-300 bg-white py-2.5 text-[14px] font-semibold text-zinc-800",
                )}
              >
                Réessayer la génération automatique
              </button>
              <button
                type="button"
                onClick={() => void requestHelp()}
                disabled={helpPhase === "sending" || helpPhase === "sent"}
                className={cn(
                  montserrat.className,
                  "flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#5E3023] px-6 text-[14px] font-semibold text-white disabled:opacity-60",
                )}
              >
                <LifeBuoy className="h-4 w-4" aria-hidden />
                {helpPhase === "sent"
                  ? "Demande envoyée à Segna"
                  : helpPhase === "sending"
                    ? "Envoi…"
                    : "Demander de l’aide — création par Segna"}
              </button>
              {helpPhase === "error" ? (
                <p className={cn(montserrat.className, "text-center text-[12px] text-rose-700")}>
                  Envoi impossible pour le moment. Écris-nous depuis l’app ou par email.
                </p>
              ) : null}
              {helpPhase === "sent" ? (
                <p className={cn(montserrat.className, "text-center text-[12px] text-zinc-600")}>
                  L’équipe voit ta demande dans l’espace back-office et peut générer l’étiquette à ta place. Actualise cette page
                  plus tard.
                </p>
              ) : null}
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/80">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className={cn(
                    montserrat.className,
                    "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] font-semibold text-zinc-800",
                  )}
                >
                  Conseils si ça bloque encore
                  <ChevronDown
                    className={cn("h-4 w-4 shrink-0 transition-transform", showAdvanced ? "rotate-180" : "")}
                    aria-hidden
                  />
                </button>
                {showAdvanced ? (
                  <div className={cn(montserrat.className, "space-y-2 border-t border-zinc-200 px-3 pb-3 pt-2 text-[12px] leading-relaxed text-zinc-600")}>
                    <p>
                      Vérifie que ton <strong>profil</strong> contient une adresse complète (rue, numéro, code postal, ville) et un
                      numéro de mobile. Sans relais compatible près de ton code postal, l’automatisation peut échouer : dans ce
                      cas la demande d’aide ci-dessus permet à Segna de finaliser l’expédition comme avant.
                    </p>
                    {mondial?.last_member_mr_error_message ? (
                      <p className="font-mono text-[11px] text-zinc-500">
                        Détail technique : {mondial.last_member_mr_error_message.slice(0, 280)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <p className={cn(montserrat.className, "rounded-xl bg-zinc-100 px-3 py-2 text-[13px] leading-relaxed text-zinc-600")}>
                {autoPhase === "skipped"
                  ? "Dès que ton annonce est validée et en phase expédition, ton bordereau peut être créé automatiquement sur cette page."
                  : "Bordereau en préparation…"}
              </p>
              <button
                type="button"
                onClick={() => void fetchData()}
                className={cn(
                  montserrat.className,
                  "w-full rounded-full border border-zinc-300 bg-white py-2.5 text-[14px] font-semibold text-zinc-800",
                )}
              >
                Actualiser
              </button>
            </div>
          )}

          {mondial?.numero_suivi ? (
            <p className={cn(montserrat.className, "mt-4 text-[15px] text-zinc-700")}>
              Numéro de suivi : <span className="font-mono font-semibold text-zinc-900">{mondial.numero_suivi}</span>
            </p>
          ) : null}

          {mondial?.lien_suivi ? (
            <a
              href={mondial.lien_suivi}
              target="_blank"
              rel="noreferrer"
              className={cn(montserrat.className, "mt-2 inline-flex items-center gap-1 text-[14px] font-semibold text-[#5E3023] underline")}
            >
              Suivre le colis
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}

          {inVerification ? (
            <p className={cn(montserrat.className, "mt-4 text-[13px] leading-relaxed text-zinc-500")}>
              Colis reçu chez Segna : vérification en cours.
            </p>
          ) : null}

          {isLoading ? <p className={cn(montserrat.className, "mt-4 text-[13px] text-zinc-500")}>Chargement…</p> : null}
        </section>
      </div>
    </main>
  );
}
