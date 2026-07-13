import { segnaDialogBodyClass } from "@/components/ui/SegnaAppDialog";
import {
  cartLegalInfoLinkClassName,
  GUEST_CG_SALE_HREF,
  GUEST_CG_SALE_LABEL_FR,
} from "@/lib/cart/guest-cart-legal-links";
import { cn } from "@/lib/utils/cn";

type GuestPurchaseInfoContentProps = {
  className?: string;
};

export function GuestPurchaseInfoContent({ className }: GuestPurchaseInfoContentProps) {
  return (
    <div className={cn(segnaDialogBodyClass(), "space-y-3.5", className)}>
      <p>Le montant affiché correspond au prix d&apos;achat des pièces sélectionnées.</p>
      <p>
        Les modalités applicables à l&apos;achat sont précisées dans les{" "}
        <a href={GUEST_CG_SALE_HREF} target="_blank" rel="noopener noreferrer" className={cartLegalInfoLinkClassName}>
          {GUEST_CG_SALE_LABEL_FR}
        </a>
        .
      </p>
    </div>
  );
}
