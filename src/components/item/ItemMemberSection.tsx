"use client";

import { Montserrat } from "next/font/google";

import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });

export type ItemMemberSectionData = {
  displayName: string;
  pronouns: string | null;
  isVerified: boolean;
  photoUrls: string[];
};

type ItemMemberSectionProps = {
  data: ItemMemberSectionData | null;
  isLoading?: boolean;
  className?: string;
};

export function ItemMemberSection({ data, isLoading, className }: ItemMemberSectionProps) {
  if (isLoading) {
    return (
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm",
          className,
        )}
      >
        <div className="h-6 w-32 animate-pulse rounded bg-zinc-200" />
        <div className="mt-4 flex gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-[3/4] w-24 shrink-0 animate-pulse rounded-xl bg-zinc-200" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm",
          className,
        )}
      >
        <p className={cn(montserrat.className, "text-[14px] font-semibold text-zinc-400")}>Section membre</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <h3 className={cn(montserrat.className, "text-[20px] font-bold text-zinc-900")}>{data.displayName}</h3>
        {data.isVerified ? (
          <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white"
            aria-label="Vérifié"
          >
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M2 6l3 3 5-6" />
            </svg>
          </span>
        ) : null}
      </div>
      {data.pronouns ? (
        <p className={cn(montserrat.className, "mt-0.5 text-[14px] text-zinc-500")}>{data.pronouns}</p>
      ) : null}
      {data.photoUrls.length > 0 ? (
        <div className="mt-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex gap-3">
            {data.photoUrls.map((url, index) => (
              <div
                key={index}
                className="relative h-32 w-24 shrink-0 overflow-hidden rounded-xl bg-zinc-100"
              >
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
