import { cn } from "@/lib/utils/cn";

type BorrowLocationInfoContentProps = {
  className?: string;
};

export function BorrowLocationInfoContent({ className }: BorrowLocationInfoContentProps) {
  return (
    <div className={cn("space-y-3 text-[15px] leading-snug text-zinc-700", className)}>
      <p>
        Segna utilise d&apos;abord tes <strong className="font-semibold text-zinc-950">crédits</strong> pour louer. Ils
        te sont rendus au retour de la pièce.
      </p>
      <p>
        S&apos;il en manque, un <strong className="font-semibold text-zinc-950">complément en euros</strong> permet de
        finaliser la location. Ce n&apos;est pas un achat de crédits.
      </p>
    </div>
  );
}
