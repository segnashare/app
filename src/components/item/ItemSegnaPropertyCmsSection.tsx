"use client";

import { useMemo } from "react";

import { CmsSegnaStockPropertyFrames } from "@/components/cms/CmsSectionBlocks";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { mapCmsRowsWithSegnaPlaceholders } from "@/lib/cms/interpolate-segna-stock-placeholders";

import { ItemSegnaDetentionSection } from "./ItemSegnaDetentionSection";

export function ItemSegnaPropertyCmsSection({
  cmsRows,
  loadingClientCms,
  pricePoints,
  sizeLabel,
}: {
  cmsRows: CmsFrameRow[];
  loadingClientCms: boolean;
  pricePoints: number | null;
  sizeLabel: string;
}) {
  const interpolated = useMemo(
    () => mapCmsRowsWithSegnaPlaceholders(cmsRows, { pricePoints, sizeLabel }),
    [cmsRows, pricePoints, sizeLabel],
  );

  if (loadingClientCms) {
    return <SegnaSkeletonBlock className="h-24 w-full" rounded="rounded-2xl" />;
  }

  if (interpolated.length === 0) {
    return <ItemSegnaDetentionSection pricePoints={pricePoints} sizeLabel={sizeLabel} />;
  }

  return <CmsSegnaStockPropertyFrames rows={interpolated} />;
}
