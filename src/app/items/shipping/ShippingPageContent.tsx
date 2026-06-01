"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ShippingBordereauExperience } from "@/components/shipping/ShippingBordereauExperience";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { buildIntakeShippingPageHrefFromIds } from "@/lib/items/intake-cart-return-piggyback";

import { parseShippingIdsFromSearch, shippingIdsAreWellFormed } from "./shipping-ids";

function shippingIdSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort().join(",");
  const sb = [...b].sort().join(",");
  return sa === sb;
}

type GateState = "checking" | "ok" | "reject";

/**
 * Même logique que la carte « Préparer ton envoi » (`ItemIntakePanel`) : bordereau / suivi tant que la pièce
 * n’est pas vérifiée catalogue ou refusée logistique.
 */
function intakeAllowsShippingBordereauPage(listingStage: string, fulfillmentStage: string | null | undefined): boolean {
  const ls = String(listingStage ?? "").trim().toLowerCase();
  if (ls !== "validated") return false;
  if (fulfillmentStage == null || String(fulfillmentStage).trim() === "") {
    return true;
  }
  const fs = String(fulfillmentStage).trim().toLowerCase();
  if (fs === "verified" || fs === "refused") return false;
  return fs === "ready" || fs === "shipping" || fs === "in_verification";
}

export function ShippingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get("ids") ?? "";
  const ids = useMemo(() => parseShippingIdsFromSearch(raw), [raw]);
  const soloParam = searchParams.get("solo") === "1";

  const [gate, setGate] = useState<GateState>("checking");
  const [validatedIds, setValidatedIds] = useState<string[]>([]);

  const runGate = useCallback(async () => {
    if (!shippingIdsAreWellFormed(ids)) {
      setGate("reject");
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
    const supabase = createSupabaseBrowserClient() as any;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setGate("reject");
      return;
    }

    const { data: rows } = await supabase
      .from("items")
      .select("id,item_intake(listing_stage,fulfillment_stage,metadata)")
      .eq("owner_user_id", user.id)
      .is("deleted_at", null)
      .in("id", ids);

    const found = (rows ?? []) as Array<{
      id: string;
      item_intake?:
        | { listing_stage?: string; fulfillment_stage?: string | null; metadata?: unknown }
        | { listing_stage?: string; fulfillment_stage?: string | null; metadata?: unknown }[]
        | null;
    }>;

    if (found.length !== ids.length) {
      setGate("reject");
      return;
    }

    for (const row of found) {
      const emb = Array.isArray(row.item_intake) ? row.item_intake[0] : row.item_intake;
      const ls = emb && typeof emb === "object" ? String((emb as { listing_stage?: string }).listing_stage ?? "") : "";
      const fsRaw =
        emb && typeof emb === "object" ? (emb as { fulfillment_stage?: string | null }).fulfillment_stage : null;
      if (!intakeAllowsShippingBordereauPage(ls, fsRaw)) {
        setGate("reject");
        return;
      }
    }

    const primary = [...ids].sort((a, b) => a.localeCompare(b))[0]!;
    let effectiveIds = ids;

    if (soloParam) {
      effectiveIds = primary ? [primary] : ids.slice(0, 1);
    }

    setValidatedIds(effectiveIds);
    setGate("ok");
  }, [ids, soloParam]);

  useEffect(() => {
    void runGate();
  }, [runGate]);

  useEffect(() => {
    if (gate !== "ok") return;
    if (soloParam) return;
    if (soloParam && validatedIds.length < ids.length && validatedIds[0]) {
      router.replace(
        `/items/shipping?ids=${encodeURIComponent(validatedIds[0])}&solo=1`,
      );
      return;
    }

    let cancelled = false;
    (async () => {
      const focus = ids[0] ?? "";
      if (!focus) return;
      try {
        const res = await fetch(
          `/api/items/shipping/default-ids?focus_id=${encodeURIComponent(focus)}`,
          { headers: { Accept: "application/json" } },
        );
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; item_ids?: string[] };
        if (cancelled || !data.ok || !Array.isArray(data.item_ids)) return;
        const group = data.item_ids;
        if (group.length < 2) return;
        if (shippingIdSetsEqual(group, ids)) {
          await fetch("/api/items/shipping/ack-group", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ item_ids: group }),
          }).catch(() => undefined);
          return;
        }
        await fetch("/api/items/shipping/ack-group", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ item_ids: group }),
        }).catch(() => undefined);
        router.replace(buildIntakeShippingPageHrefFromIds(group));
      } catch {
        /* garde l’URL courante */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gate, ids, router, searchParams, soloParam, validatedIds]);

  useEffect(() => {
    if (gate !== "reject") return;
    router.replace("/exchange");
  }, [gate, router]);

  if (gate !== "ok") {
    return <div className="min-h-[100dvh] bg-white" aria-busy="true" />;
  }

  return (
    <ShippingBordereauExperience headerTitle="Bordereau d'envoi" backHref="/exchange" itemIds={validatedIds} />
  );
}
