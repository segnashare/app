import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type AppViewportProps = {
  children: ReactNode;
  className?: string;
  /** Merged onto the outer `<main>` (e.g. `bg-white` for auth screens). */
  outerClassName?: string;
  /** Styles inline sur le `<main>` externe (ex. couleur de fond animée). */
  outerStyle?: CSSProperties;
  /**
   * Full-viewport column without the fixed phone aspect ratio — use for minimal auth screens
   * so the background is continuous (no “card” on a different grey).
   */
  fillHeight?: boolean;
  /**
   * Avec `fillHeight` : garde ~430px sur mobile, mais élargit la colonne à partir de `md`
   * (ex. rangée d’images) pour éviter `overflow-x-hidden` qui rogne les bords.
   */
  fillHeightWideAtMd?: boolean;
};

export function AppViewport({
  children,
  className,
  outerClassName,
  outerStyle,
  fillHeight,
  fillHeightWideAtMd,
}: AppViewportProps) {
  return (
    <main
      className={cn(
        "flex w-full bg-[#f9f9f8]",
        fillHeight
          ? "min-h-dvh min-w-0 flex-col items-stretch justify-start"
          : "h-dvh min-h-[844px] min-w-[390px] items-center justify-center",
        outerClassName,
      )}
      style={outerStyle}
    >
      <div
        className={cn(
          fillHeight
            ? cn(
                "mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto",
                fillHeightWideAtMd
                  ? "max-w-[min(100%,430px)] md:max-w-[min(100%,min(92vw,880px))]"
                  : "max-w-[min(100%,430px)]",
              )
            : "mx-auto flex aspect-[390/844] h-[min(100dvh,calc(100vw*844/390))] min-h-[844px] w-[min(100vw,calc(100dvh*390/844))] min-w-[390px] flex-col justify-between overflow-y-auto px-6 py-8 md:px-8 md:py-10",
          className,
        )}
      >
        {children}
      </div>
    </main>
  );
}
