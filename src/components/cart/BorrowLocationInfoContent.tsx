import { segnaDialogBodyClass } from "@/components/ui/SegnaAppDialog";
import {
  cartLegalInfoLinkClassName,
  GUEST_CG_LOCATION_HREF,
  GUEST_CG_LOCATION_LABEL_FR,
} from "@/lib/cart/guest-cart-legal-links";
import { cn } from "@/lib/utils/cn";

type BorrowLocationInfoContentProps = {
  className?: string;
};

export function BorrowLocationInfoContent({ className }: BorrowLocationInfoContentProps) {
  return (
    <div className={cn(segnaDialogBodyClass(), "space-y-3.5", className)}>
      <p>Le montant affiché correspond à la durée de location sélectionnée.</p>
      <p>
        En cas de retard ou de non-restitution, des frais complémentaires peuvent être appliqués conformément aux{" "}
        <a
          href={GUEST_CG_LOCATION_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className={cartLegalInfoLinkClassName}
        >
          {GUEST_CG_LOCATION_LABEL_FR}
        </a>
        .
      </p>
    </div>
  );
}
