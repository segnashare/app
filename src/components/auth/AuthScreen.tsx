import type { ReactNode } from "react";

import { AppViewport } from "@/components/layout/AppViewport";
import { cn } from "@/lib/utils/cn";

type AuthScreenProps = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function AuthScreen({
  title,
  description,
  children,
  footer,
  className,
}: AuthScreenProps) {
  return (
    <AppViewport className={cn("gap-8", className)}>
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900">{title}</h1>
        {description ? <p className="text-sm text-zinc-600">{description}</p> : null}
      </section>

      <section className="flex-1">{children}</section>

      {footer ? <footer className="text-center text-xs text-zinc-500">{footer}</footer> : null}
    </AppViewport>
  );
}
