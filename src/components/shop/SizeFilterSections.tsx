"use client";

import { Fragment, useMemo, type ReactNode } from "react";

import { segnaDialogBodyClass } from "@/components/ui/SegnaAppDialog";
import {
  SIZE_FILTER_RAYONS,
  allSizeIdsInCategory,
  groupSizesByCategory,
  isSizeOptionSelected,
  sousRayonLabel,
  type SizeFilterCategory,
  type SizeFilterOption,
} from "@/lib/shop/size-filter-groups";
import { cn } from "@/lib/utils/cn";

type SizeFilterSectionsProps = {
  sizes: SizeFilterOption[];
  selectedIds: string[];
  browseCategory: SizeFilterCategory | null;
  onBrowseCategoryChange: (category: SizeFilterCategory | null) => void;
  /** Toggle une option agrégée (top+bottom) — reçoit l’option complète. */
  onToggleOption: (option: SizeFilterOption) => void;
  onClearAll: () => void;
  onSelectAllInCategory: (ids: string[]) => void;
  scrollRowClassName: string;
  renderRayonChip: (props: { label: string; active: boolean; onClick: () => void }) => ReactNode;
  renderSizeChip: (props: { option: SizeFilterOption; active: boolean; onClick: () => void }) => ReactNode;
};

export function SizeFilterSections({
  sizes,
  selectedIds,
  browseCategory,
  onBrowseCategoryChange,
  onToggleOption,
  onClearAll,
  onSelectAllInCategory,
  scrollRowClassName,
  renderRayonChip,
  renderSizeChip,
}: SizeFilterSectionsProps) {
  const grouped = useMemo(() => groupSizesByCategory(sizes), [sizes]);
  const categoryOptions = browseCategory ? grouped[browseCategory] : [];
  const categoryIds = browseCategory ? allSizeIdsInCategory(grouped, browseCategory) : [];
  const allInCategorySelected =
    categoryIds.length > 0 && categoryIds.every((id) => selectedIds.includes(id));

  return (
    <div className="space-y-4">
      <div>
        <p className={cn(segnaDialogBodyClass("mb-1.5 font-semibold text-zinc-900"))}>Rayons</p>
        <div className={scrollRowClassName}>
          {renderRayonChip({
            label: "Tous",
            active: browseCategory === null && selectedIds.length === 0,
            onClick: () => {
              onBrowseCategoryChange(null);
              onClearAll();
            },
          })}
          {SIZE_FILTER_RAYONS.map(({ key, label }) => {
            if (grouped[key].length === 0) return null;
            return (
              <Fragment key={key}>
                {renderRayonChip({
                  label,
                  active: browseCategory === key,
                  onClick: () => onBrowseCategoryChange(key),
                })}
              </Fragment>
            );
          })}
        </div>
      </div>

      {browseCategory && categoryOptions.length > 0 ? (
        <div>
          <p className={cn(segnaDialogBodyClass("mb-1.5 font-semibold text-zinc-900"))}>Sous-catégories</p>
          <div className={scrollRowClassName}>
            {renderRayonChip({
              label: sousRayonLabel(browseCategory),
              active: allInCategorySelected,
              onClick: () => onSelectAllInCategory(categoryIds),
            })}
            {categoryOptions.map((option) => {
              const active = isSizeOptionSelected(option, selectedIds);
              return (
                <Fragment key={`${option.code}:${option.id}`}>
                  {renderSizeChip({
                    option,
                    active,
                    onClick: () => onToggleOption(option),
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
