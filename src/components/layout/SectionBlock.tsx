import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type SectionBlockProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

export function SectionBlock({ title, description, children, className, titleClassName, descriptionClassName }: SectionBlockProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <header className="space-y-1">
        <h2 className={cn("text-base font-semibold text-zinc-950", titleClassName)}>{title}</h2>
        {description ? <p className={cn("text-sm text-zinc-600", descriptionClassName)}>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
