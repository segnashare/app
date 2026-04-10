"use client";

import { useEffect, useState } from "react";

import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

let inflight: Promise<CmsFrameRow[]> | null = null;
let cachedRows: CmsFrameRow[] | null = null;

async function getSegnaStockPropertyCmsCached(): Promise<CmsFrameRow[]> {
  if (cachedRows) return cachedRows;
  if (inflight) return inflight;
  inflight = (async () => {
    const sb = createSupabaseBrowserClient() as unknown as StorageSignClient;
    const rows = await fetchCmsSectionFramesResolved(sb, "segna_stock_property");
    cachedRows = rows;
    inflight = null;
    return rows;
  })();
  return inflight;
}

/**
 * Frames publiées de la section `segna_stock_property` (Propriété Segna), avec cache partagé entre instances.
 */
export function useSegnaStockPropertyCmsRows(enabled: boolean): { rows: CmsFrameRow[]; loading: boolean } {
  const [rows, setRows] = useState<CmsFrameRow[]>(() => (enabled && cachedRows ? cachedRows : []));
  const [loading, setLoading] = useState(() => enabled && cachedRows == null);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    if (cachedRows) {
      setRows(cachedRows);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getSegnaStockPropertyCmsCached().then((r) => {
      if (!cancelled) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { rows, loading };
}
