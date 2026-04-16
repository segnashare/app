import Image from "next/image";
import Link from "next/link";

import type { MemberReturnPageUi, ReturnPageCta } from "@/lib/cart/member-return-page-ui";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const BODY_GRAY = "text-[#545454]";

const btnPrimary = cn(
  segnaMontserrat.className,
  "inline-flex min-w-0 flex-1 items-center justify-center rounded-full bg-black px-4 py-2.5 text-center text-[15px] font-bold leading-none text-white transition hover:bg-zinc-900 active:scale-[0.99] sm:px-5 sm:py-3 sm:text-[16px]",
);
const btnSecondary = cn(
  segnaMontserrat.className,
  "inline-flex min-w-0 flex-1 items-center justify-center rounded-full border border-black bg-white px-4 py-2.5 text-center text-[15px] font-bold leading-none text-black transition hover:bg-zinc-50 active:scale-[0.99] sm:px-5 sm:py-3 sm:text-[16px]",
);

function CtaLink({ cta }: { cta: ReturnPageCta }) {
  const cls = cta.variant === "primary" ? btnPrimary : btnSecondary;
  const isExternal = /^https?:\/\//i.test(cta.href);
  return (
    <Link href={cta.href} className={cls} {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {cta.label}
    </Link>
  );
}

type Props = {
  ui: MemberReturnPageUi;
};

/**
 * Bloc œil + accroche + textes + CTA — même gabarit que {@link EmpruntBorrowSummarySection}.
 */
export function RetourPhaseHeroSection({ ui }: Props) {
  return (
    <section
      className={cn(
        segnaMontserrat.className,
        "flex flex-col items-center border-b border-zinc-100 px-5 pb-6 pt-3 text-center",
      )}
      aria-labelledby="retour-phase-hero-title"
    >
      <div className="relative mx-auto w-full max-w-[220px] shrink-0">
        <Image
          src="/ressources/oeil_charme.png"
          alt=""
          width={480}
          height={480}
          className="mx-auto h-auto w-full max-h-[180px] object-contain"
        />
      </div>
      <h2
        id="retour-phase-hero-title"
        className="mt-5 max-w-[20rem] text-[22px] font-bold leading-tight tracking-tight text-black sm:text-[24px]"
      >
        {ui.heroTagline}
      </h2>
      {ui.bodyLines.length > 0 ? (
        <div className="mt-3 max-w-[24rem] space-y-2">
          {ui.bodyLines.map((line, i) => (
            <p key={i} className={cn("text-[15px] font-normal leading-relaxed", BODY_GRAY)}>
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {ui.ctas.length > 0 ? (
        <div
          className={cn(
            "flex w-full max-w-md flex-row flex-wrap items-stretch justify-center gap-2 sm:gap-2.5",
            ui.bodyLines.length > 0 ? "mt-8" : "mt-6",
          )}
        >
          {ui.ctas.map((cta) => (
            <CtaLink key={`${cta.href}-${cta.label}`} cta={cta} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
