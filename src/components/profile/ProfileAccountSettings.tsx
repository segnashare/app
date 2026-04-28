"use client";

import Link from "next/link";
import { ChevronRight, ExternalLink, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { SettingsSignOutButton } from "@/components/profile/SettingsSignOutButton";
import type { MembershipLabel } from "@/lib/user/resolve-membership-label";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

/** Trait le plus léger : identique entre le titre de section et la liste, et entre chaque ligne. */
const SETTINGS_RULE_TOP = "border-t border-zinc-100";
const SETTINGS_LIST_DIVIDE = "divide-y divide-zinc-100";

const SETTINGS_HEADER_PT = "pt-[max(1.125rem,calc(env(safe-area-inset-top,0px)+14px))]";
const SETTINGS_HEADER_PB = "pb-4";

type ProfileTabBack = "plus" | "me";

type ProfileAccountSettingsProps = {
  backTab: ProfileTabBack;
  isSubscriber: boolean;
  membershipLabel: MembershipLabel;
  /** KYC Stripe Identity validé (requis pour souscrire à SegnaX). */
  kycVerified: boolean;
  supportEmail: string | null;
};

function SectionBlock({ title, ariaLabel, children }: { title: string; ariaLabel: string; children: ReactNode }) {
  return (
    <section className="bg-white px-0 pt-5 first:pt-4">
      <h2 className={cn("min-w-0 px-5 pb-3", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>{title}</h2>
      <div className={SETTINGS_RULE_TOP}>
        <div className={cn(montserrat.className, SETTINGS_LIST_DIVIDE)} role="navigation" aria-label={ariaLabel}>
          {children}
        </div>
      </div>
    </section>
  );
}

function SettingsLinkRow({
  href,
  title,
  subtitle,
  external,
}: {
  href: string;
  title: string;
  subtitle?: string;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex min-h-[52px] w-full items-center gap-3 px-5 py-3.5 pr-4 text-left transition hover:bg-zinc-50"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-medium leading-snug text-zinc-900">{title}</p>
        {subtitle ? <p className="mt-0.5 text-[13px] leading-snug text-zinc-500">{subtitle}</p> : null}
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300" aria-hidden />
    </Link>
  );
}

function SettingsDisabledRow({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex min-h-[52px] w-full items-center gap-3 px-5 py-3.5 pr-4 opacity-55" aria-disabled>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-medium leading-snug text-zinc-900">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-zinc-500">{subtitle}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-zinc-200" aria-hidden />
    </div>
  );
}

function subscriberPlanBadge(label: MembershipLabel): string | null {
  if (label === "Membre X") return "SegnaX";
  if (label === "Membre +") return "Segna+";
  return null;
}

export function ProfileAccountSettings({
  backTab,
  isSubscriber,
  membershipLabel,
  kycVerified,
  supportEmail,
}: ProfileAccountSettingsProps) {
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const planBadge = subscriberPlanBadge(membershipLabel);
  const packageChangeHref = membershipLabel === "Membre X" ? "/package?plan=x" : "/package";

  const profileHref = `/profile?tab=${encodeURIComponent(backTab)}`;
  const profileSubflowTabQuery = `tab=${encodeURIComponent(backTab)}`;
  const kycHref = `/profile/kyc?${profileSubflowTabQuery}`;
  const packageSegnaXHref = "/package?plan=x";
  const dataExportHref =
    supportEmail && supportEmail.length > 0
      ? `mailto:${supportEmail}?subject=${encodeURIComponent("Demande d'export de mes données (RGPD)")}&body=${encodeURIComponent(
          "Bonjour,\n\nJe souhaite recevoir une copie de mes données personnelles associées à mon compte Segna.\n\nMerci.",
        )}`
      : null;

  const deleteOrSuspendHref =
    supportEmail && supportEmail.length > 0
      ? `mailto:${supportEmail}?subject=${encodeURIComponent("Suppression ou suspension de compte Segna")}&body=${encodeURIComponent(
          "Bonjour,\n\nJe souhaite supprimer ou suspendre mon compte Segna.\n\nMerci de me recontacter avec la marche à suivre.\n\nCordialement,",
        )}`
      : null;

  const openBillingPortal = async () => {
    if (portalBusy) return;
    setPortalError(null);
    setPortalBusy(true);
    try {
      const res = await fetch("/api/stripe/subscription/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTab: backTab }),
      });
      const payload = (await res.json().catch(() => null)) as { url?: string; message?: string } | null;
      if (!res.ok || !payload?.url) {
        throw new Error(payload?.message ?? "Impossible d'ouvrir le portail de facturation.");
      }
      window.location.assign(payload.url);
    } catch (e) {
      setPortalError(e instanceof Error ? e.message : "Une erreur est survenue.");
      setPortalBusy(false);
    }
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
        <div className={cn("grid min-h-14 w-full grid-cols-[3rem_1fr_3rem] items-center px-2", SETTINGS_HEADER_PT, SETTINGS_HEADER_PB)}>
          <Link
            href={profileHref}
            className="inline-flex h-12 w-12 items-center justify-center justify-self-start rounded-full text-zinc-900 transition hover:bg-zinc-100"
            aria-label="Fermer"
          >
            <X className="h-8 w-8" strokeWidth={2.25} />
          </Link>
          <h1 className="min-w-0 px-0.5 text-center text-[17px] font-bold leading-[1.15] text-zinc-900 sm:text-[18px]">
            Paramètres du compte
          </h1>
          <span className="inline-block w-12 shrink-0 justify-self-end" aria-hidden />
        </div>
      </header>

      {/* Réserve la hauteur du header fixe (même padding + ligne grille 3rem). */}
      <div aria-hidden className={cn("mx-auto w-full max-w-[430px] shrink-0 bg-white", SETTINGS_HEADER_PT, SETTINGS_HEADER_PB)}>
        <div className="min-h-14 w-full" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col space-y-[4.5px] pt-[4.5px] pb-[max(2rem,calc(env(safe-area-inset-bottom,0px)+1.25rem))]">
        <section className="bg-white px-0 pt-[4.5px] first:pt-[4.5px]">
          <h2 className={cn("min-w-0 px-5 pb-3 pt-4", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Mentions légales</h2>
          <div className={SETTINGS_RULE_TOP}>
            <div className={cn(montserrat.className, SETTINGS_LIST_DIVIDE)} role="navigation" aria-label="Mentions légales">
              <SettingsLinkRow href="/legal/confidentialite" title="Politique de confidentialité" />
              <SettingsLinkRow href="/legal/contrat-services" title="Conditions d'utilisation" />
              <SettingsLinkRow
                href="/legal/conditions-generales-location"
                title="Conditions générales de location"
                subtitle="Pour les échanges et locations sur Segna."
              />
              <SettingsLinkRow
                href="/legal/confidentialite"
                title="Préférences de confidentialité"
                subtitle="Détail dans la politique de confidentialité."
              />
              <SettingsLinkRow href="/legal/contrat-services" title="Licences et services" subtitle="Cadre contractuel Segna." />
              {dataExportHref ? (
                <SettingsLinkRow href={dataExportHref} title="Télécharger mes données" subtitle="Demande par e-mail au support." external />
              ) : (
                <SettingsDisabledRow title="Télécharger mes données" subtitle="Contacte le support depuis l’app." />
              )}
            </div>
          </div>
        </section>

        <SectionBlock title="Communauté Segna" ariaLabel="Communauté Segna">
          <SettingsLinkRow
            href={`/profile/reports?${profileSubflowTabQuery}`}
            title="Échanges respectueux"
            subtitle="Signale un comportement inapproprié après un match ou un échange."
          />
          <SettingsLinkRow
            href={`/profile/blocks?${profileSubflowTabQuery}`}
            title="Membres et interactions"
            subtitle="Gère les blocages pour garder ta communauté saine."
          />
          <SettingsLinkRow
            href={`/profile/kyc?${profileSubflowTabQuery}`}
            title="Confiance sur la plateforme"
            subtitle="Identité vérifiée : rassure les autres membres."
          />
        </SectionBlock>

        <SectionBlock title="Sécurité" ariaLabel="Sécurité">
          <SettingsLinkRow
            href={`/profile/kyc?${profileSubflowTabQuery}`}
            title="Vérification d'identité"
            subtitle="Selfie et document : sécurise ton compte."
          />
          <SettingsLinkRow href={`/profile/blocks?${profileSubflowTabQuery}`} title="Liste de blocage" subtitle="Bloque des profils ou des contacts." />
          <SettingsLinkRow href={`/profile/reports?${profileSubflowTabQuery}`} title="Signalements" subtitle="Aide-nous à modérer les contenus." />
        </SectionBlock>

        <SectionBlock title="Notifications" ariaLabel="Notifications">
          <SettingsDisabledRow title="Notifications push" subtitle="Réglages détaillés : bientôt dans l’app." />
          <SettingsDisabledRow title="E-mail" subtitle="Choix des e-mails Segna : bientôt." />
        </SectionBlock>

        <SectionBlock title="Abonnement" ariaLabel="Abonnement">
          {isSubscriber ? (
            <div className="px-5 py-5">
              <p className="text-balance text-[16px] font-semibold leading-snug text-zinc-900">
                Merci pour ton abonnement Segna
                {planBadge ? (
                  <span className="ml-2 inline-block align-middle rounded-full bg-sky-100 px-2.5 py-0.5 text-[12px] font-bold tracking-tight text-sky-950">
                    {planBadge}
                  </span>
                ) : null}
              </p>
              <p className="mt-2 text-balance text-[13px] leading-snug text-zinc-500">
                Profite de tes avantages membre (points mensuels, échanges…).{" "}
                <Link href={packageChangeHref} className="font-medium text-zinc-800 underline underline-offset-2">
                  Découvrir les offres
                </Link>
              </p>
              <div className="mt-5 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => void openBillingPortal()}
                  disabled={portalBusy}
                  className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border border-zinc-300 bg-white px-4 text-center text-[15px] font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {portalBusy ? "Ouverture…" : "Voir la facturation"}
                  <ExternalLink className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
                </button>
                <Link
                  href={packageChangeHref}
                  className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-zinc-950 px-4 text-center text-[15px] font-semibold text-white transition hover:bg-zinc-800"
                >
                  Changer d’offre
                </Link>
              </div>
            </div>
          ) : (
            <>
              <SettingsLinkRow
                href={kycHref}
                title="Vérification d’identité (KYC)"
                subtitle={
                  kycVerified
                    ? "Identité validée — tu peux souscrire à SegnaX."
                    : "Obligatoire avant tout abonnement : selfie et pièce d’identité."
                }
              />
              <SettingsLinkRow
                href={kycVerified ? packageSegnaXHref : kycHref}
                title="S’abonner à SegnaX"
                subtitle={
                  kycVerified
                    ? "Formules, engagement et essai : tout sur une page."
                    : "Valide d’abord ton KYC pour débloquer l’abonnement."
                }
              />
            </>
          )}
        </SectionBlock>

        <section className="mt-[4.5px] bg-white">
          <div className={cn(montserrat.className, SETTINGS_LIST_DIVIDE)} role="navigation" aria-label="Compte et abonnement">
            <SettingsSignOutButton variant="row" />
            {deleteOrSuspendHref ? (
              <a
                href={deleteOrSuspendHref}
                className="flex min-h-[52px] items-center justify-center px-5 py-4 text-center text-[16px] font-medium text-zinc-900 transition hover:bg-zinc-50"
              >
                Supprimer ou suspendre le compte
              </a>
            ) : (
              <div className="flex min-h-[52px] items-center justify-center px-5 py-4 text-center text-[15px] font-medium text-zinc-500">
                Supprimer ou suspendre le compte — contacte le support depuis l’app.
              </div>
            )}
          </div>
          {portalError ? <p className="border-t border-zinc-100 px-5 py-3 text-center text-sm text-red-600">{portalError}</p> : null}
        </section>

        {/* Évite le fond zinc-100 visible sous le dernier bloc quand la page est plus haute que le contenu. */}
        <div className="min-h-0 flex-1 bg-white" aria-hidden />
      </div>
    </main>
  );
}
