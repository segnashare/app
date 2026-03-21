"use client";

import { cn } from "@/lib/utils/cn";

import type { ProfileViewBrand } from "./ProfileView";

type BrandsCardProps = {
  brands: ProfileViewBrand[];
  className?: string;
};

export function BrandsCard({ brands, className }: BrandsCardProps) {
  if (brands.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-around gap-4 rounded-2xl border border-zinc-200 bg-white px-4 py-2",
        className,
      )}
    >
      {brands.map((brand) => (
        <div
          key={brand.id || brand.label}
          className="flex flex-1 min-w-0 max-w-[120px] items-center justify-center"
        >
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brand.label}
              className="h-12 w-auto max-h-14 object-contain object-center"
            />
          ) : (
            <span className="truncate text-center text-sm font-semibold text-zinc-900">
              {brand.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
