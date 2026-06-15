import { NextResponse } from "next/server";

import { buildShopPageLoadContext } from "@/lib/shop/build-shop-page-load-context";
import {
  loadShopPageRemainder,
  loadShopPageSectionChunk,
  type ShopProgressiveChunk,
} from "@/lib/shop/load-shop-page-progressive";

type ProgressiveRequestBody = {
  sectionKey?: string;
  step?: "remainder";
  existingItemIds?: string[];
  existingCovers?: Record<string, string>;
  loadedSectionKeys?: string[];
};

export async function POST(request: Request) {
  const ctx = await buildShopPageLoadContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: ProgressiveRequestBody;
  try {
    body = (await request.json()) as ProgressiveRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const existingItemIds = new Set(
    (body.existingItemIds ?? []).filter((id): id is string => typeof id === "string" && id.trim().length > 0),
  );
  const existingCovers = body.existingCovers ?? {};
  const loadedSectionKeys = new Set(
    (body.loadedSectionKeys ?? []).filter((key): key is string => typeof key === "string" && key.trim().length > 0),
  );

  let chunk: ShopProgressiveChunk;

  if (body.step === "remainder") {
    chunk = await loadShopPageRemainder(ctx, loadedSectionKeys, existingItemIds, existingCovers);
  } else if (typeof body.sectionKey === "string" && body.sectionKey.trim()) {
    chunk = await loadShopPageSectionChunk(ctx, body.sectionKey.trim(), existingItemIds, existingCovers);
  } else {
    return NextResponse.json({ error: "missing_section_key" }, { status: 400 });
  }

  return NextResponse.json(chunk);
}
