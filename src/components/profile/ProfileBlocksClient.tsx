"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { frenchLocalToE164, normalizeFrenchLocalNumber } from "@/lib/phone/fr-mobile";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

const ALERTE_OEIL_PNG = "/ressources/Alerte_oeil.png";
const ALERTE_OEIL_FALLBACK = "/ressources/Oeil/Oeil choqué+fond.svg";

/** Onglet « Bloquées » : illustration dédiée (fichier attendu dans `public/ressources/`). */
const OEIL_BLOQUE_PNG = "/ressources/oeil_bloqué.png";
const OEIL_BLOQUE_FALLBACK_ASCII = "/ressources/oeil_bloque.png";

function AlerteOeilIllustration({ className }: { className?: string }) {
  return (
    <img
      src={ALERTE_OEIL_PNG}
      alt=""
      decoding="async"
      onError={(e) => {
        const el = e.currentTarget;
        if (!el.src.includes("Alerte_oeil.png")) return;
        el.onerror = null;
        el.src = ALERTE_OEIL_FALLBACK;
      }}
      className={cn("h-auto max-h-[160px] w-auto max-w-[min(220px,78vw)] object-contain", className)}
    />
  );
}

function OeilBloqueIllustration({ className }: { className?: string }) {
  return (
    <img
      src={OEIL_BLOQUE_PNG}
      alt=""
      decoding="async"
      onError={(e) => {
        const el = e.currentTarget;
        const step = el.dataset.oeilFb ?? "";
        if (step === "") {
          el.dataset.oeilFb = "ascii";
          el.src = OEIL_BLOQUE_FALLBACK_ASCII;
          return;
        }
        if (step === "ascii") {
          el.dataset.oeilFb = "svg";
          el.src = ALERTE_OEIL_FALLBACK;
          return;
        }
        el.onerror = null;
      }}
      className={cn("h-auto max-h-[160px] w-auto max-w-[min(220px,78vw)] object-contain", className)}
    />
  );
}

function stripLeadingDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

function sectionLetterFromTitle(title: string): string {
  const t = stripLeadingDiacritics(title.trim());
  const c = t.charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

function initialsFromLineTitle(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0] ?? "";
    const b = parts[1][0] ?? "";
    return (a + b).toUpperCase();
  }
  if (parts.length === 1) {
    const w = parts[0];
    if (w.length >= 2) return w.slice(0, 2).toUpperCase();
    if (w.length === 1) return w.toUpperCase();
  }
  return "?";
}

/** Affichage type +33 7 50 90 32 17 */
function formatFrenchMobileDisplay(e164: string | null | undefined): string {
  if (!e164) return "—";
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("33") && d.length >= 11) {
    const n = d.slice(2, 11);
    if (n.length !== 9) return e164;
    return `+33 ${n[0]} ${n.slice(1, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7, 9)}`;
  }
  if (d.length === 10 && d.startsWith("0")) {
    return formatFrenchMobileDisplay(`+33${d.slice(1)}`);
  }
  return e164;
}

type ProfileBlocksClientProps = {
  backTab: "plus" | "me";
};

type BlockRow = {
  id: string;
  blockedUserId: string | null;
  blockedPhoneE164: string | null;
  blockedLabel: string | null;
  lineTitle: string;
  phoneLine: string;
  emailLine: string | null;
};

type TabId = "manual" | "blocked";

export function ProfileBlocksClient({ backTab }: ProfileBlocksClientProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);
  const settingsHref = `/profile/settings?tab=${encodeURIComponent(backTab)}`;

  const [tab, setTab] = useState<TabId>("manual");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<BlockRow[]>([]);
  const [query, setQuery] = useState("");
  const [confirmUnblock, setConfirmUnblock] = useState<BlockRow | null>(null);
  const [unblockBusy, setUnblockBusy] = useState(false);

  const [manualFirstName, setManualFirstName] = useState("");
  const [manualPhoneLocal, setManualPhoneLocal] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadBlocks = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setEntries([]);
        setLoadError("Connecte-toi pour gérer tes blocages.");
        return;
      }

      const { data: rpcRows, error: rpcErr } = await supabase.rpc("list_my_user_blocks_v1");

      if (rpcErr) {
        setLoadError(rpcErr.message);
        setEntries([]);
        return;
      }

      const rowsRpc = (rpcRows ?? []) as Array<{
        id?: string | null;
        blocked_user_id?: string | null;
        blocked_phone_e164?: string | null;
        blocked_label?: string | null;
        line_title?: string | null;
        member_email?: string | null;
        member_phone_e164?: string | null;
      }>;

      const next: BlockRow[] = rowsRpc
        .map((r) => {
          const id = typeof r.id === "string" ? r.id : "";
          if (!id) return null;
          const blockedUserId = typeof r.blocked_user_id === "string" ? r.blocked_user_id : null;
          const blockedPhoneE164 =
            typeof r.blocked_phone_e164 === "string" && r.blocked_phone_e164.trim().length > 0 ? r.blocked_phone_e164.trim() : null;
          const blockedLabel =
            typeof r.blocked_label === "string" && r.blocked_label.trim().length > 0 ? r.blocked_label.trim() : null;
          if (!blockedUserId && !blockedPhoneE164) return null;

          const lineTitle =
            typeof r.line_title === "string" && r.line_title.trim().length > 0 ? r.line_title.trim() : "Membre Segna";
          const emailRaw = typeof r.member_email === "string" ? r.member_email.trim() : "";
          const phoneE164 = typeof r.member_phone_e164 === "string" ? r.member_phone_e164.trim() : null;

          return {
            id,
            blockedUserId,
            blockedPhoneE164,
            blockedLabel,
            lineTitle,
            phoneLine: formatFrenchMobileDisplay(phoneE164),
            emailLine: emailRaw.length > 0 ? emailRaw : null,
          } satisfies BlockRow;
        })
        .filter((x): x is BlockRow => x !== null);

      setEntries(next);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadBlocks();
  }, [loadBlocks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay = [
        e.lineTitle,
        e.phoneLine,
        e.emailLine ?? "",
        e.blockedUserId ?? "",
        e.blockedPhoneE164 ?? "",
        e.blockedLabel ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query]);

  const blockedSections = useMemo(() => {
    const sorted = [...filtered].sort((a, b) =>
      stripLeadingDiacritics(a.lineTitle).localeCompare(stripLeadingDiacritics(b.lineTitle), "fr", { sensitivity: "base" }),
    );
    const byLetter = new Map<string, BlockRow[]>();
    for (const row of sorted) {
      const L = sectionLetterFromTitle(row.lineTitle);
      if (!byLetter.has(L)) byLetter.set(L, []);
      byLetter.get(L)!.push(row);
    }
    const letters = [...byLetter.keys()].sort((a, b) => {
      if (a === "#" && b !== "#") return 1;
      if (b === "#" && a !== "#") return -1;
      return a.localeCompare(b, "fr");
    });
    return letters.map((letter) => ({ letter, rows: byLetter.get(letter)! }));
  }, [filtered]);

  const blockedTabTitle = entries.length > 0 ? `Bloquées (${entries.length})` : "Bloquées";

  const onConfirmUnblock = async () => {
    if (!confirmUnblock) return;
    setUnblockBusy(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from("user_blocks").update({ deleted_at: now }).eq("id", confirmUnblock.id);
      if (error) {
        setLoadError(error.message);
        return;
      }
      setEntries((prev) => prev.filter((e) => e.id !== confirmUnblock.id));
      setConfirmUnblock(null);
    } finally {
      setUnblockBusy(false);
    }
  };

  const onAddManualBlock = async () => {
    setAddError(null);
    const firstName = manualFirstName.trim();
    if (firstName.length < 1 || firstName.length > 80) {
      setAddError("Indique un prénom (1 à 80 caractères).");
      return;
    }
    const national = normalizeFrenchLocalNumber(manualPhoneLocal);
    if (national.length !== 9) {
      setAddError("Indique un numéro mobile français à 9 chiffres (sans le +33).");
      return;
    }
    const e164 = frenchLocalToE164(manualPhoneLocal);
    if (!e164) {
      setAddError("Numéro invalide.");
      return;
    }

    setAddBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setAddError("Session expirée. Reconnecte-toi.");
        return;
      }

      const { data: meRow } = await supabase.from("users").select("phone").eq("id", user.id).maybeSingle();
      const myPhone = typeof meRow?.phone === "string" ? meRow.phone.replace(/\s/g, "") : "";
      if (myPhone && myPhone === e164.replace(/\s/g, "")) {
        setAddError("Tu ne peux pas bloquer ton propre numéro.");
        return;
      }

      let resolvedUserId: string | null = null;
      const { data: matchUser } = await supabase.from("users").select("id").eq("phone", e164).maybeSingle();
      if (matchUser && typeof matchUser.id === "string") {
        resolvedUserId = matchUser.id;
        if (resolvedUserId === user.id) {
          setAddError("Tu ne peux pas bloquer ton propre compte.");
          return;
        }
      }

      const { error } = await supabase.from("user_blocks").insert({
        blocked_by_user_id: user.id,
        blocked_user_id: resolvedUserId,
        blocked_phone_e164: e164,
        blocked_label: firstName,
      });

      if (error) {
        const msg = (error.message ?? "").toLowerCase();
        if (error.code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
          setAddError("Ce numéro est déjà dans ta liste de blocage.");
        } else {
          setAddError(error.message ?? "Impossible d’ajouter ce blocage.");
        }
        return;
      }

      setManualFirstName("");
      setManualPhoneLocal("");
      await loadBlocks();
      setTab("blocked");
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <main className={cn(montserrat.className, "mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col bg-white")}>
      <header className="fixed left-1/2 top-0 z-40 w-full max-w-[430px] -translate-x-1/2 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center justify-between gap-2">
            <Link
              href={settingsHref}
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900 transition hover:bg-zinc-100"
              aria-label="Fermer"
            >
              <X className="h-8 w-8" strokeWidth={2.25} />
            </Link>
            <div className="h-12 w-12 shrink-0" aria-hidden />
          </div>
          <h1 className={cn("mt-5 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Liste de blocage</h1>
          <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">Gère les profils que tu ne souhaites plus croiser sur Segna.</p>
        </div>
      </header>

      <div
        className="mx-auto h-[calc(env(safe-area-inset-top,0px)+12.5rem)] w-full max-w-[430px] shrink-0 bg-white"
        aria-hidden
      />

      <div className="flex min-h-0 flex-1 flex-col bg-white px-0 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
        <div className="border-b border-zinc-100 bg-white px-5">
          <div className="grid w-full grid-cols-2">
            <button
              type="button"
              onClick={() => setTab("manual")}
              className={cn(
                "min-h-12 border-b-2 px-1 py-2 text-center text-[clamp(15px,4.2vw,20px)] font-extrabold leading-tight",
                tab === "manual" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-300",
              )}
            >
              Ajout manuel
            </button>
            <button
              type="button"
              onClick={() => setTab("blocked")}
              className={cn(
                "min-h-12 border-b-2 px-1 py-2 text-center text-[clamp(15px,4.2vw,20px)] font-extrabold leading-tight",
                tab === "blocked" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-300",
              )}
            >
              <span className="block truncate">{blockedTabTitle}</span>
            </button>
          </div>
        </div>

        {tab === "manual" ? (
          <section className="flex min-h-0 flex-1 flex-col bg-white px-5 py-8">
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-6 flex h-40 w-40 items-center justify-center">
                <AlerteOeilIllustration />
              </div>
              <p className={cn(montserrat.className, "max-w-sm text-[17px] font-semibold leading-snug text-zinc-900")}>
                Bloquer un membre manuellement
              </p>

              <div className="mt-8 w-full max-w-md space-y-4 text-left">
                <div>
                  <label htmlFor="manual-block-firstname" className="text-[14px] font-semibold text-zinc-900">
                    Prénom
                  </label>
                  <input
                    id="manual-block-firstname"
                    type="text"
                    autoComplete="given-name"
                    placeholder="Ex. Camille"
                    value={manualFirstName}
                    onChange={(e) => {
                      setManualFirstName(e.target.value);
                      setAddError(null);
                    }}
                    className="mt-2 h-12 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[15px] text-zinc-900 outline-none ring-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:ring-2"
                  />
                </div>
                <div>
                  <label htmlFor="manual-block-phone" className="text-[14px] font-semibold text-zinc-900">
                    Numéro de mobile (France)
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="shrink-0 text-[15px] font-semibold text-zinc-600">+33</span>
                    <input
                      id="manual-block-phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder="612345678"
                      value={manualPhoneLocal}
                      onChange={(e) => {
                        setManualPhoneLocal(e.target.value);
                        setAddError(null);
                      }}
                      className="h-12 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-[15px] text-zinc-900 outline-none ring-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:ring-2"
                    />
                  </div>
                </div>
                {addError ? <p className="text-[13px] font-medium text-[#E44D3E]">{addError}</p> : null}
                <button
                  type="button"
                  disabled={addBusy || manualFirstName.trim().length === 0 || normalizeFrenchLocalNumber(manualPhoneLocal).length === 0}
                  onClick={() => void onAddManualBlock()}
                  className="inline-flex h-12 w-full items-center justify-center rounded-full bg-zinc-900 px-4 text-[16px] font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {addBusy ? "Ajout…" : "Ajouter à la liste de blocage"}
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col bg-white">
            <div className="border-b border-zinc-100 px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Recherche par nom, numéro ou e-mail"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-10 pr-3 text-[15px] text-zinc-900 outline-none ring-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:ring-2"
                />
              </div>
            </div>

            {loadError ? (
              <p className="px-5 py-4 text-sm text-red-600">{loadError}</p>
            ) : loading ? (
              <p className="px-5 py-8 text-center text-sm text-zinc-500">Chargement…</p>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <div className="relative mb-6 flex h-40 w-40 items-center justify-center">
                  <OeilBloqueIllustration />
                </div>
                <p className={cn(montserrat.className, "text-[17px] font-semibold leading-snug text-zinc-900")}>
                  Aucun profil bloqué pour l’instant
                </p>
                <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-zinc-600">
                  Utilise l’onglet <span className="font-semibold text-zinc-800">Ajout manuel</span> ou bloque quelqu’un depuis le feed ou une
                  fiche membre : la liste se mettra à jour ici.
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <div className="relative mb-4 flex h-32 w-32 items-center justify-center">
                  <OeilBloqueIllustration className="max-h-[120px]" />
                </div>
                <p className="text-sm text-zinc-500">Aucun résultat pour cette recherche.</p>
              </div>
            ) : (
              <div className={cn(montserrat.className, "border-t border-zinc-100")}>
                {blockedSections.map(({ letter, rows }) => (
                  <div key={letter}>
                    <div className="border-b border-zinc-200 px-5 py-3">
                      <span className="text-[26px] font-bold leading-none tracking-tight text-zinc-900">{letter}</span>
                    </div>
                    {rows.map((row) => {
                      const initials = initialsFromLineTitle(row.lineTitle);
                      return (
                        <div
                          key={row.id}
                          className="flex items-center justify-between gap-4 border-b border-zinc-100 px-5 py-4"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-[17px] font-bold leading-tight text-zinc-900">{initials}</p>
                            <p className="mt-1 text-[14px] font-medium leading-snug text-zinc-600">{row.phoneLine}</p>
                            {row.emailLine ? (
                              <p className="mt-0.5 truncate text-[13px] leading-snug text-zinc-400">{row.emailLine}</p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => setConfirmUnblock(row)}
                            className="shrink-0 self-center rounded-full bg-zinc-100 px-4 py-2 text-[14px] font-semibold text-zinc-900 transition hover:bg-zinc-200"
                          >
                            Débloquer
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {confirmUnblock ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => {
            if (!unblockBusy) setConfirmUnblock(null);
          }}
        >
          <div
            className={cn(SEGNA_DIALOG_CARD_CLASS, "relative")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="unblock-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <SegnaDialogDismissButton variant="overlay" onClick={() => !unblockBusy && setConfirmUnblock(null)} />
            <h2 id="unblock-dialog-title" className={cn(segnaDialogTitleClass(), "pr-10")}>
              Débloquer {confirmUnblock.lineTitle} ?
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-3")}>
              Cette personne pourra à nouveau apparaître dans ton expérience Segna (suggestions, échanges…), selon les règles habituelles de la
              plateforme.
            </p>
            <div className="mt-6 flex border-t border-zinc-100 pt-4">
              <button
                type="button"
                disabled={unblockBusy}
                onClick={() => setConfirmUnblock(null)}
                className="flex-1 py-2.5 text-center text-[16px] font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={unblockBusy}
                onClick={() => void onConfirmUnblock()}
                className="flex-1 border-l border-zinc-100 py-2.5 text-center text-[16px] font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-50"
              >
                {unblockBusy ? "…" : "Débloquer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
