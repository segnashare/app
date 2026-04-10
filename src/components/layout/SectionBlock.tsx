import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils/cn";

type SectionBlockProps = {
  title: string;
  /** Si défini, le titre devient un lien (ex. vers une page détail). */
  titleHref?: string;
  /** Contenu aligné à droite du titre (même ligne / baseline). */
  titleEnd?: ReactNode;
  description?: string;
  children: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

export function SectionBlock({
  title,
  titleHref,
  titleEnd,
  description,
  children,
  className,
  titleClassName,
  descriptionClassName,
}: SectionBlockProps) {
  const titleInner =
    titleHref != null && titleHref.trim() !== "" ? (
      <Link
        href={titleHref.trim()}
        className="text-inherit decoration-transparent decoration-2 underline-offset-[0.18em] transition hover:underline hover:decoration-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      >
        {title}
      </Link>
    ) : (
      title
    );

  return (
    <section className={cn("space-y-3", className)}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <h2 className={cn("min-w-0 text-base font-semibold text-zinc-950", titleClassName)}>{titleInner}</h2>
          {titleEnd ? <div className="shrink-0 text-right">{titleEnd}</div> : null}
        </div>
        {description ? <p className={cn("text-sm text-zinc-600", descriptionClassName)}>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
