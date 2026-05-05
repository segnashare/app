"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";

import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const SEGNA_WEB_PRIVACY_POLICY = "https://www.segnashare.com/politique-confidentialite";

/** Même système que `ProfileAccountSettings`. */
const SETTINGS_RULE_TOP = "border-t border-zinc-100";
const SETTINGS_LIST_DIVIDE = "divide-y divide-zinc-100";

const SETTINGS_HEADER_PT = "pt-[max(1.125rem,calc(env(safe-area-inset-top,0px)+14px))]";
const SETTINGS_HEADER_PB = "pb-4";

type LegalPrivacyPreferencesClientProps = {
  settingsHref: string;
};

function SegnaSwitch({
  checked,
  onCheckedChange,
  id,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  id: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      id={id}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-[31px] w-[51px] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2",
        checked ? "bg-zinc-900" : "bg-zinc-200",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="sr-only">{checked ? "Activé" : "Désactivé"}</span>
      <span
        className={cn(
          "pointer-events-none absolute top-[3px] h-[25px] w-[25px] rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[23px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

function ToolRow({
  title,
  subtitle,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full min-h-[52px] items-start gap-2 px-5 py-3.5 pr-4 text-left transition hover:bg-zinc-50"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-medium leading-snug text-zinc-900">{title}</p>
          {subtitle ? <p className="mt-0.5 text-[13px] leading-snug text-zinc-500">{subtitle}</p> : null}
          {expanded && children ? (
            <div className="mt-3 border-t border-zinc-100 pt-3 pb-1">{children}</div>
          ) : null}
        </div>
        <ChevronRight
          className={cn("mt-0.5 h-5 w-5 shrink-0 text-zinc-300 transition-transform", expanded && "rotate-90")}
          aria-hidden
        />
      </button>
    </div>
  );
}

export function LegalPrivacyPreferencesClient({ settingsHref }: LegalPrivacyPreferencesClientProps) {
  const montserrat = segnaMontserrat;
  const allowAllId = useId();
  const [allowAll, setAllowAll] = useState<boolean | null>(null);
  const [openKey, setOpenKey] = useState<null | "necessary" | "sharing" | "marketing">(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("segna_privacy_allow_all");
      if (raw === "0") setAllowAll(false);
      else if (raw === "1") setAllowAll(true);
      else setAllowAll(true);
    } catch {
      setAllowAll(true);
    }
  }, []);

  const persistAllowAll = useCallback((next: boolean) => {
    setAllowAll(next);
    try {
      localStorage.setItem("segna_privacy_allow_all", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSection = (key: typeof openKey) => {
    setOpenKey((prev) => (prev === key ? null : key));
  };

  return (
    <main
      className={cn(
        montserrat.className,
        "mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col bg-zinc-100",
      )}
    >
      <header
        className={cn(
          montserrat.className,
          "fixed left-1/2 top-0 z-[41] w-full max-w-[430px] -translate-x-1/2 bg-white",
        )}
      >
        <div className={cn("grid min-h-14 w-full grid-cols-[1fr_auto_1fr] items-center gap-2 px-2", SETTINGS_HEADER_PT, SETTINGS_HEADER_PB)}>
          <Link
            href={settingsHref}
            className="justify-self-start rounded-full px-2 py-2 text-[16px] font-semibold text-zinc-900 transition hover:bg-zinc-100"
          >
            Annuler
          </Link>
          <h1
            className={cn(
              "min-w-0 max-w-[46vw] truncate px-0.5 text-center text-[17px] font-bold leading-[1.15] text-zinc-900 sm:max-w-[min(280px,72vw)] sm:text-[18px]",
              segnaPlayfairDisplay.className,
            )}
          >
            Préférences de confidentialité
          </h1>
          <Link
            href={settingsHref}
            className="justify-self-end rounded-full px-2 py-2 text-[16px] font-semibold text-zinc-900 transition hover:bg-zinc-100"
          >
            Terminé
          </Link>
        </div>
      </header>

      <div aria-hidden className={cn("shrink-0 bg-white", SETTINGS_HEADER_PT, SETTINGS_HEADER_PB)}>
        <div className="min-h-14 w-full" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col space-y-[4.5px] pt-[4.5px] pb-[max(2rem,calc(env(safe-area-inset-bottom,0px)+1.25rem))]">
        <section className="bg-white px-0 pt-[4.5px]">
          <p className="px-5 pb-5 pt-4 text-[13px] leading-relaxed text-zinc-500">
            L&apos;utilisation de <span className="font-semibold text-zinc-700">Segna</span> implique le stockage et la récupération
            d&apos;informations à partir de ton appareil, via des outils opérés par nous ou nos partenaires de confiance. Ci-dessous, nous te
            proposons un moyen simple d&apos;ajuster tes choix en fonction de ces intégrations. Tu peux modifier tes choix à tout moment dans
            ces paramètres.{" "}
            <a
              href={SEGNA_WEB_PRIVACY_POLICY}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-zinc-900 underline underline-offset-2 transition hover:text-zinc-700"
            >
              Politique de confidentialité
            </a>
          </p>

          <div className={SETTINGS_RULE_TOP}>
            <div className="flex items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <label htmlFor={allowAllId} className="text-[16px] font-medium text-zinc-900">
                  Autoriser tous les services
                </label>
                <p className="mt-0.5 text-[13px] leading-snug text-zinc-500">
                  Les nouveaux services seront activés par défaut.
                </p>
              </div>
              {allowAll === null ? (
                <div className="h-[31px] w-[51px] shrink-0 rounded-full bg-zinc-100" aria-hidden />
              ) : (
                <SegnaSwitch id={allowAllId} checked={allowAll} onCheckedChange={persistAllowAll} />
              )}
            </div>
          </div>
        </section>

        <section className="bg-white px-0 pt-5 first:pt-4">
          <h2 className={cn("min-w-0 px-5 pb-3", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Gérer les outils</h2>
          <div className={SETTINGS_RULE_TOP}>
            <div className={cn(montserrat.className, SETTINGS_LIST_DIVIDE)} role="navigation" aria-label="Gérer les outils">
              <ToolRow
                title="Autorisations strictement nécessaires"
                expanded={openKey === "necessary"}
                onToggle={() => toggleSection("necessary")}
              >
                <p className="text-[13px] leading-relaxed text-zinc-600">
                  Ces outils sont indispensables au fonctionnement de l&apos;appli et ne peuvent être désactivés. Ils permettent des
                  fonctionnalités comme l&apos;authentification, la gestion de ton compte et les échanges entre membres.
                </p>
              </ToolRow>

              <ToolRow
                title="Partage de données Segna"
                expanded={openKey === "sharing"}
                onToggle={() => toggleSection("sharing")}
              >
                <p className="text-[13px] leading-relaxed text-zinc-600">
                  Segna peut partager certaines données techniques ou d&apos;usage avec des prestataires qui nous aident à faire tourner la
                  plateforme (hébergement, sécurité, analyse d&apos;audience), dans les limites décrites dans notre politique de confidentialité
                  et selon tes réglages.
                </p>
              </ToolRow>

              <ToolRow
                title="Personnaliser les services marketing"
                subtitle="J'active les services marketing. Les nouveaux services marketing seront activés."
                expanded={openKey === "marketing"}
                onToggle={() => toggleSection("marketing")}
              >
                <p className="text-[13px] leading-relaxed text-zinc-600">
                  Quand cette option est disponible, tu peux limiter la personnalisation des contenus promotionnels. Le réglage global «
                  Autoriser tous les services » prime sur les nouveaux outils tant que tu ne les désactives pas un par un.
                </p>
              </ToolRow>
            </div>
          </div>
        </section>

        <div className="min-h-0 flex-1 bg-white" aria-hidden />
      </div>
    </main>
  );
}
