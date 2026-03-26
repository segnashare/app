import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type SectionBlockProps = {
  title: string;
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
  titleEnd,
  description,
  children,
  className,
  titleClassName,
  descriptionClassName,
}: SectionBlockProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <h2 className={cn("min-w-0 text-base font-semibold text-zinc-950", titleClassName)}>{title}</h2>
          {titleEnd ? <div className="shrink-0 text-right">{titleEnd}</div> : null}
        </div>
        {description ? <p className={cn("text-sm text-zinc-600", descriptionClassName)}>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
