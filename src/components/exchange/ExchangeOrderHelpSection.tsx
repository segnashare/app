"use client";

import { openMemberFeedbackModal } from "@/lib/feedback/open-member-feedback-modal";
import { segnaHeaderInlineLinkClass } from "@/lib/ui/segna-inline-link";
import { cn } from "@/lib/utils/cn";

type ExchangeOrderHelpSectionProps = {
  /** `header` : coin haut droit à côté du bouton fermer ; `footer` : sous le contenu. */
  placement?: "header" | "footer";
  /** Libellé du lien déclencheur (défaut : aide commande). */
  triggerLabel?: string;
};

/**
 * Lien d’aide ouvrant la modale membre (bulle chat : signalement / question).
 */
export function ExchangeOrderHelpSection({
  placement = "footer",
  triggerLabel = "Aide commande",
}: ExchangeOrderHelpSectionProps) {
  const trigger = (
    <button
      type="button"
      onClick={openMemberFeedbackModal}
      className={cn(
        segnaHeaderInlineLinkClass,
        placement === "header" ? "text-right whitespace-nowrap" : "text-left",
      )}
    >
      {triggerLabel}
    </button>
  );

  if (placement === "header") {
    return <div className="shrink-0">{trigger}</div>;
  }

  return (
    <footer className="mt-3 border-0 bg-transparent px-0 pb-1 pt-0">
      {trigger}
    </footer>
  );
}
