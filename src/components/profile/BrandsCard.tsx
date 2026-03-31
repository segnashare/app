"use client";

import { ImageCoverWithSkeleton } from "@/components/ui/ImageCoverWithSkeleton";
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
            <div className="relative flex h-14 w-full max-w-[120px] items-center justify-center overflow-hidden rounded-lg bg-zinc-200">
              <ImageCoverWithSkeleton
                src={brand.logoUrl}
                alt={brand.label}
                objectFit="contain"
                className="h-full max-h-14 w-full"
                imgClassName="p-1"
                loading="lazy"
              />
            </div>
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
