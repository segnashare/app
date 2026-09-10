"use client";

import { Fragment, useMemo, type ReactNode } from "react";

import { segnaDialogBodyClass } from "@/components/ui/SegnaAppDialog";
import {
  groupSizesByCategory,
  isSizeOptionSelected,
  type SizeFilterLayout,
  type SizeFilterOption,
} from "@/lib/shop/size-filter-groups";
import { cn } from "@/lib/utils/cn";

type SizeFilterSectionsProps = {
  sizes: SizeFilterOption[];
  selectedIds: string[];
  layout: SizeFilterLayout;
  onToggleOption: (option: SizeFilterOption) => void;
  onClearRow: (memberIds: string[]) => void;
  scrollRowClassName: string;
  renderRowChip: (props: { label: string; active: boolean; onClick: () => void }) => ReactNode;
  renderSizeChip: (props: { option: SizeFilterOption; active: boolean; onClick: () => void }) => ReactNode;
};

function SizeChipRow({
  title,
  options,
  selectedIds,
  showTitle,
  scrollRowClassName,
  onToggleOption,
  onClearRow,
  renderRowChip,
  renderSizeChip,
}: {
  title: string;
  options: SizeFilterOption[];
  selectedIds: string[];
  showTitle: boolean;
  scrollRowClassName: string;
  onToggleOption: (option: SizeFilterOption) => void;
  onClearRow: (memberIds: string[]) => void;
  renderRowChip: SizeFilterSectionsProps["renderRowChip"];
  renderSizeChip: SizeFilterSectionsProps["renderSizeChip"];
}) {
  const rowIds = options.flatMap((s) => s.memberIds ?? [s.id]);
  const anySelected = rowIds.some((id) => selectedIds.includes(id));

  if (options.length === 0) return null;

  return (
    <div>
      {showTitle ? (
        <p className={cn(segnaDialogBodyClass("mb-1.5 font-semibold text-zinc-900"))}>{title}</p>
      ) : null}
      <div className={scrollRowClassName}>
        {renderRowChip({
          label: "Tous",
          active: !anySelected,
          onClick: () => onClearRow(rowIds),
        })}
        {options.map((option) => {
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
  );
}

export function SizeFilterSections({
  sizes,
  selectedIds,
  layout,
  onToggleOption,
  onClearRow,
  scrollRowClassName,
  renderRowChip,
  renderSizeChip,
}: SizeFilterSectionsProps) {
  const grouped = useMemo(() => groupSizesByCategory(sizes), [sizes]);
  const showBoth = layout.showApparel && layout.showShoes;

  if (layout.disabled) {
    return (
      <p className={cn(segnaDialogBodyClass("text-zinc-500"))}>
        Taille unique — le filtre taille ne s&apos;applique pas à cette catégorie.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {layout.showApparel ? (
        <SizeChipRow
          title="Vêtements"
          options={grouped.apparel}
          selectedIds={selectedIds}
          showTitle={showBoth}
          scrollRowClassName={scrollRowClassName}
          onToggleOption={onToggleOption}
          onClearRow={onClearRow}
          renderRowChip={renderRowChip}
          renderSizeChip={renderSizeChip}
        />
      ) : null}
      {layout.showShoes ? (
        <SizeChipRow
          title="Pointures"
          options={grouped.shoes}
          selectedIds={selectedIds}
          showTitle={showBoth}
          scrollRowClassName={scrollRowClassName}
          onToggleOption={onToggleOption}
          onClearRow={onClearRow}
          renderRowChip={renderRowChip}
          renderSizeChip={renderSizeChip}
        />
      ) : null}
    </div>
  );
}
