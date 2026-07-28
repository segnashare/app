"use client";

import Link from "next/link";
import { ChevronRight, ExternalLink, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { SettingsAdminPhantomRow } from "@/components/profile/SettingsAdminPhantomRow";
import { SettingsContactSection } from "@/components/profile/SettingsContactSection";
import { SettingsSignOutButton } from "@/components/profile/SettingsSignOutButton";
import type { MembershipLabel } from "@/lib/user/resolve-membership-label";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

/** Trait le plus léger : identique entre le titre de section et la liste, et entre chaque ligne. */
const SETTINGS_RULE_TOP = "border-t border-zinc-100";
const SETTINGS_LIST_DIVIDE = "divide-y divide-zinc-100";

const SEGNA_WEB_PRIVACY_POLICY = "https://www.segnashare.com/politique-confidentialite";
const SEGNA_WEB_TERMS_OF_USE = "https://www.segnashare.com/conditions-generales-utilisation";
const SEGNA_WEB_RENTAL_TERMS = "https://www.segnashare.com/conditions-location";

type ProfileTabBack = "plus" | "me";

type ProfileAccountSettingsProps = {
  backTab: ProfileTabBack;
  isSubscriber: boolean;
  membershipLabel: MembershipLabel;
  /** KYC Stripe Identity validé (requis pour souscrire à SegnaX). */
  kycVerified: boolean;
  supportEmail: string | null;
  /** Compte équipe Segna (rôle app `admin`) : accès au mode Phantom. */
  isStaffAdmin: boolean;
  /** État initial du mode Phantom (colonne `users.phantom_mode`). */
  initialAdminPhantomMode: boolean;
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
  isStaffAdmin,
  initialAdminPhantomMode,
}: ProfileAccountSettingsProps) {
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);
  const planBadge = subscriberPlanBadge(membershipLabel);
  const packageChangeHref = membershipLabel === "Membre X" ? "/package?plan=x" : "/package";

  const profileHref = `/profile?tab=${encodeURIComponent(backTab)}`;
  const profileSubflowTabQuery = `tab=${encodeURIComponent(backTab)}`;
  const kycHref = `/profile/kyc?${profileSubflowTabQuery}`;
  const packageSegnaXHref = "/package?plan=x";

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

  const requestDeleteAccount = async () => {
    if (deleteBusy) return;
    const confirmed = window.confirm(
      "Confirmer la demande de suppression du compte ?\n\nLa suppression sera bloquée automatiquement tant que tes commandes/retours ne sont pas entièrement clôturés.",
    );
    if (!confirmed) return;

    setDeleteBusy(true);
    setDeleteFeedback(null);
    try {
      const res = await fetch("/api/account/delete/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            blocked?: boolean;
            blockers?: {
              open_carts?: number;
              open_outbound_shipments?: number;
              open_return_shipments?: number;
              open_cart_items?: number;
            };
            error?: string;
          }
        | null;

      if (!res.ok) {
        throw new Error(payload?.error ?? "Impossible d'envoyer la demande.");
      }

      const blocked = Boolean(payload?.blocked);
      const blockers = payload?.blockers ?? {};
      if (blocked) {
        const openCarts = Number(blockers.open_carts ?? 0);
        const openOutboundShipments = Number(blockers.open_outbound_shipments ?? 0);
        const openReturnShipments = Number(blockers.open_return_shipments ?? 0);
        const openCartItems = Number(blockers.open_cart_items ?? 0);
        const details = [
          openCarts > 0 ? `${openCarts} commande(s) encore ouverte(s)` : null,
          openOutboundShipments > 0 ? `${openOutboundShipments} expédition(s) aller en cours` : null,
          openReturnShipments > 0 ? `${openReturnShipments} retour(s) en cours` : null,
          openCartItems > 0 ? `${openCartItems} pièce(s) pas encore rendue(s)` : null,
        ]
          .filter(Boolean)
          .join(", ");
        setDeleteFeedback(
          `Suppression bloquée pour l'instant: ${details || "des opérations de location sont encore actives"}. Termine les retours et la vérification des pièces, puis réessaie.`,
        );
      } else {
        setDeleteFeedback("Demande de suppression enregistrée. Notre équipe va te recontacter pour finaliser le processus.");
      }
    } catch (e) {
      setDeleteFeedback(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      setDeleteBusy(false);
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
          "fixed left-1/2 top-0 z-40 w-full max-w-[430px] -translate-x-1/2 bg-white",
        )}
      >
        {/* Même logique que panier / paiement : ligne d’action, titre Playfair en dessous, sans trait sous le header */}
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center justify-between gap-2">
            <Link
              href={profileHref}
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900 transition hover:bg-zinc-100"
              aria-label="Fermer"
            >
              <X className="h-8 w-8" strokeWidth={2.25} />
            </Link>
            <div className="h-12 w-12 shrink-0" aria-hidden />
          </div>
          <h1 className={cn("mt-5 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Paramètres du compte</h1>
        </div>
      </header>

      {/* Réserve la place du header fixe (même ordre de grandeur que le panier : titre Playfair plus long que « Paiement »). */}
      <div
        className="mx-auto h-[calc(env(safe-area-inset-top,0px)+10.25rem)] w-full max-w-[430px] shrink-0 bg-white"
        aria-hidden
      />

      <div className="flex min-h-0 flex-1 flex-col space-y-[4.5px] pt-[4.5px] pb-[max(2rem,calc(env(safe-area-inset-bottom,0px)+1.25rem))]">
        <section className="bg-white px-0 pt-[4.5px] first:pt-[4.5px]">
          <h2 className={cn("min-w-0 px-5 pb-3 pt-4", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Mentions légales</h2>
          <div className={SETTINGS_RULE_TOP}>
            <div className={cn(montserrat.className, SETTINGS_LIST_DIVIDE)} role="navigation" aria-label="Mentions légales">
              <SettingsLinkRow
                href={SEGNA_WEB_PRIVACY_POLICY}
                title="Politique de confidentialité"
                external
              />
              <SettingsLinkRow href={SEGNA_WEB_TERMS_OF_USE} title="Conditions d'utilisation" external />
              <SettingsLinkRow
                href={SEGNA_WEB_RENTAL_TERMS}
                title="Conditions générales de location"
                subtitle="Pour les échanges et locations sur Segna."
                external
              />
              <SettingsLinkRow
                href={`/legal/confidentialite?${profileSubflowTabQuery}`}
                title="Préférences de confidentialité"
                subtitle="Détail dans la politique de confidentialité."
              />
            </div>
          </div>
        </section>

        {isSubscriber ? (
          <SectionBlock title="Profil" ariaLabel="Profil">
            <SettingsLinkRow
              href={`/profile/complete?${profileSubflowTabQuery}&from=settings`}
              title="Modifier mon profil"
              subtitle="Nom affiché, photos, visibilité, coordonnées…"
            />
          </SectionBlock>
        ) : null}

        <SectionBlock title="Sécurité" ariaLabel="Sécurité">
          {isStaffAdmin ? <SettingsAdminPhantomRow initialEnabled={initialAdminPhantomMode} /> : null}
          <SettingsLinkRow
            href={`/profile/kyc?${profileSubflowTabQuery}`}
            title="Vérification d'identité"
            subtitle="Selfie et document : sécurise ton compte."
          />
          <SettingsLinkRow href={`/profile/blocks?${profileSubflowTabQuery}`} title="Liste de blocage" subtitle="Bloque des profils ou des contacts." />
          <SettingsLinkRow href={`/profile/reports?${profileSubflowTabQuery}`} title="Signalements" subtitle="Aide-nous à modérer les contenus." />
        </SectionBlock>

        <SectionBlock title="Notifications" ariaLabel="Notifications">
          <SettingsLinkRow
            href={`/profile/notifications/sms?${profileSubflowTabQuery}`}
            title="SMS"
            subtitle="Commandes toujours · offres & actus au choix."
          />
          <SettingsLinkRow
            href={`/profile/notifications/email?${profileSubflowTabQuery}`}
            title="E-mail"
            subtitle="Transactionnels toujours · marketing au choix."
          />
        </SectionBlock>

        <SectionBlock title="Téléphone & e-mail" ariaLabel="Téléphone et e-mail">
          <SettingsContactSection />
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
                href={`/profile/complete?${profileSubflowTabQuery}&from=settings`}
                title="Complète ton profil pour devenir membre"
                subtitle="Tu n’as pas d’abonnement actuellement."
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
            <button
              type="button"
              onClick={() => void requestDeleteAccount()}
              disabled={deleteBusy}
              className="flex min-h-[52px] w-full items-center justify-center px-5 py-4 text-center text-[16px] font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteBusy ? "Envoi de la demande..." : "Supprimer ou suspendre le compte"}
            </button>
          </div>
          {portalError ? <p className="border-t border-zinc-100 px-5 py-3 text-center text-sm text-red-600">{portalError}</p> : null}
          {deleteFeedback ? (
            <p className="border-t border-zinc-100 px-5 py-3 text-center text-sm text-zinc-700">
              {deleteFeedback}{" "}
              {supportEmail ? (
                <>
                  Besoin d'aide ?{" "}
                  <a className="underline underline-offset-2" href={`mailto:${supportEmail}`}>
                    Contacte le support
                  </a>
                  .
                </>
              ) : null}
            </p>
          ) : null}
        </section>

        {/* Évite le fond zinc-100 visible sous le dernier bloc quand la page est plus haute que le contenu. */}
        <div className="min-h-0 flex-1 bg-white" aria-hidden />
      </div>
    </main>
  );
}
