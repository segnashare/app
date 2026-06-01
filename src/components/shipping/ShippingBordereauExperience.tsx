"use client";

import Link from "next/link";
import { ChevronLeft, ExternalLink, LifeBuoy, Loader2, Package } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IntakeNewBordereauButton } from "@/components/shipping/IntakeNewBordereauButton";
import {
  IntakeShippingExpeditionSection,
  resolveIntakeTrackingHref,
} from "@/components/shipping/IntakeShippingExpeditionSection";
import {
  buildIntakeExpandShippingHref,
  buildIntakeShippingPageHrefFromIds,
  type IntakeShippingOptionsSnapshot,
  parseItemIdsFromIntakeShippingPageHref,
  readIntakePiggybackFromMetadata,
  SC_SHIPPING_MODE_CART_RETURN_PIGGYBACK,
} from "@/lib/items/intake-cart-return-piggyback";
import { MEMBER_INTAKE_SHIPMENT_MAX_ITEMS } from "@/lib/items/member-intake-shipment";
import { parseIntakeReturnPortalFromRows } from "@/lib/items/member-intake-return-portal";
import { resolveActiveMemberIntakeShipmentIdForItems } from "@/lib/items/member-intake-shipment";
import {
  isIntakeMemberReturnTrackingNumber,
  parseIntakeShippingLabelFromMetadata,
  parseSendcloudFromIntakeMetadata,
  readMemberIntakeShipmentIdFromMetadata,
  readShippingPreferSolo,
} from "@/lib/items/intake-shipping-metadata";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SEGNA_SECTION_TITLE_CLASSNAME, segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const playfair = segnaPlayfairDisplay;

/** Message API `member-mr-auto-generate` quand `users.adress` est incomplet. */
const PROFILE_ADDRESS_INCOMPLETE_HINT = "Complète ton adresse postale dans ton profil";


type IntakeSnap = {
  listing_stage: string | null;
  fulfillment_stage: string | null;
  metadata: unknown;
};

type LoadedRow = {
  id: string;
  title: string;
  intake: IntakeSnap | null;
};

export type ShippingBordereauExperienceProps = {
  /** Titre du header fixe. Si absent : titre de la première pièce chargée (parcours fiche). Pour le parcours transverse, passer p.ex. « Bordereau d'envoi ». */
  headerTitle?: string;
  /** Cible du bouton retour. */
  backHref: string;
  /** Libellé accessibilité du retour. */
  backLabel?: string;
  /** Une ou plusieurs pièces (même étiquette Sendcloud si fusion BO). */
  itemIds: string[];
};

const portalSessionKey = (ids: string[]) => `segna-intake-return-portal:${[...ids].sort().join(",")}`;

function readStoredSendcloudError(rows: LoadedRow[]): string | null {
  for (const row of rows) {
    const sc = parseSendcloudFromIntakeMetadata(row.intake?.metadata ?? null);
    const msg = sc?.last_member_error_message?.trim();
    if (msg) return msg;
  }
  return null;
}

const PORTAL_VALID_MINUTES = 10;

function pickPortalFromRows(rows: LoadedRow[]) {
  const portal = parseIntakeReturnPortalFromRows(rows);
  return {
    portalUrl: portal.portalUrl,
    labelUrl: portal.labelUrl,
    portalReady: portal.portalReady,
    portalExpired: portal.portalExpired,
    orderNumber: portal.orderNumber,
    postalCode: portal.postalCode,
    intake: rows[0]?.intake ?? null,
  };
}

export function ShippingBordereauExperience({
  headerTitle: headerTitleProp,
  backHref,
  backLabel = "Retour",
  itemIds,
}: ShippingBordereauExperienceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shippingReturnPath = useMemo(() => {
    const qs = searchParams.toString();
    if (!pathname) return qs ? `/items/shipping?${qs}` : "/items/shipping";
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  const profileLocationEditHref = useMemo(
    () => `/profile/edit?field=location&returnPath=${encodeURIComponent(shippingReturnPath)}`,
    [shippingReturnPath],
  );

  const [rows, setRows] = useState<LoadedRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const generationAbortRef = useRef<AbortController | null>(null);
  const [autoPhase, setAutoPhase] = useState<"idle" | "trying" | "done" | "failed" | "skipped">("idle");
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoDeveloperHint, setAutoDeveloperHint] = useState<string | null>(null);
  const [helpPhase, setHelpPhase] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [shippingOptions, setShippingOptions] = useState<IntakeShippingOptionsSnapshot | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [selectedPiggybackCartId, setSelectedPiggybackCartId] = useState<string | null>(null);
  const [piggybackConfirmChecked, setPiggybackConfirmChecked] = useState(false);
  const [piggybackPhase, setPiggybackPhase] = useState<"idle" | "saving" | "error">("idle");
  const [piggybackError, setPiggybackError] = useState<string | null>(null);
  const [returnShipmentTracking, setReturnShipmentTracking] = useState<{
    trackingNumber: string | null;
    trackingHref: string | null;
  } | null>(null);
  const [memberIntakeDbTracking, setMemberIntakeDbTracking] = useState<{
    trackingNumber: string | null;
    trackingHref: string | null;
  } | null>(null);
  const [memberIntakeShipmentActive, setMemberIntakeShipmentActive] = useState(false);
  const [newBordereauShimmer, setNewBordereauShimmer] = useState(false);
  const [ungroupPhase, setUngroupPhase] = useState<"idle" | "saving">("idle");
  const [groupPhase, setGroupPhase] = useState<"idle" | "saving">("idle");

  const isShipmentUrlGrouped = itemIds.length >= 2;
  const groupingSectionCopy = useMemo(() => {
    if (isShipmentUrlGrouped) {
      return {
        sectionTitle: "Séparer tes envois",
        blockTitle: "Envoi groupé",
        description:
          "Ces pièces partagent un seul bordereau et un seul colis. Tu peux les séparer si tu préfères un envoi distinct par pièce.",
      };
    }
    const peers = shippingOptions?.other_intake_shipping_peers ?? [];
    const currentSet = new Set(itemIds);
    const extraPeers = peers.filter((p) => !currentSet.has(p.id));
    if (extraPeers.length > 0) {
      return {
        sectionTitle: "Mutualiser tes envois",
        blockTitle: "Une autre pièce au prêt",
        description:
          "Tu peux la regrouper avec la tienne et les envoyer dans un seul colis vers Segna.",
      };
    }
    return {
      sectionTitle: "Mutualiser tes envois",
      blockTitle: "Une autre pièce au prêt",
      description:
        "Tu peux en ajouter une et l’envoyer avec celle-ci dans un seul colis vers Segna (2 pièces max).",
    };
  }, [isShipmentUrlGrouped, itemIds, shippingOptions?.other_intake_shipping_peers]);
  const expandShippingHref = useMemo(() => {
    const peers = shippingOptions?.other_intake_shipping_peers ?? [];
    if (!isShipmentUrlGrouped || peers.length === 0) return null;
    return buildIntakeExpandShippingHref(itemIds, peers.map((p) => p.id));
  }, [isShipmentUrlGrouped, itemIds, shippingOptions?.other_intake_shipping_peers]);

  const showNewPieceLink = useMemo(() => {
    const peers = shippingOptions?.other_intake_shipping_peers ?? [];
    const currentSet = new Set(itemIds);
    const extraPeerCount = peers.filter((p) => !currentSet.has(p.id)).length;
    const fulfillmentCount = shippingOptions?.default_shipping_group_ids?.length ?? 0;
    if (fulfillmentCount >= MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) return false;
    if (itemIds.length >= MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) return false;
    // Pièce courante + peer déjà proposé (ex. segna_2) = lot complet à 2
    if (itemIds.length + extraPeerCount >= MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) return false;
    return true;
  }, [shippingOptions?.default_shipping_group_ids, shippingOptions?.other_intake_shipping_peers, itemIds]);

  const itemIdsKey = itemIds.join(",");
  useEffect(() => {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    setAutoPhase("idle");
    setAutoError(null);
    setAutoDeveloperHint(null);
    setHelpPhase("idle");
    setShippingOptions(null);
    setOptionsLoading(true);
    setSelectedPiggybackCartId(null);
    setPiggybackConfirmChecked(false);
    setPiggybackPhase("idle");
    setPiggybackError(null);
    setMemberIntakeDbTracking(null);
    setMemberIntakeShipmentActive(false);
    setNewBordereauShimmer(false);
  }, [itemIdsKey]);

  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(80);

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (itemIds.length === 0) {
      if (!silent) setIsLoading(false);
      return;
    }
    if (!silent) setIsLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
    const supabase = createSupabaseBrowserClient() as any;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      if (!silent) setIsLoading(false);
      return;
    }

    const loadRows = async (): Promise<LoadedRow[]> => {
      const loaded: LoadedRow[] = [];
      for (const id of itemIds) {
        const { data: row } = await supabase
          .from("items")
          .select("id,title,item_intake(listing_stage,fulfillment_stage,metadata)")
          .eq("id", id)
          .eq("owner_user_id", user.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (!row) continue;
        const r = row as Record<string, unknown>;
        const rawIntake = r.item_intake as unknown;
        const emb = Array.isArray(rawIntake) ? rawIntake[0] : rawIntake;
        let intake: IntakeSnap | null = null;
        if (emb && typeof emb === "object") {
          const o = emb as Record<string, unknown>;
          intake = {
            listing_stage: typeof o.listing_stage === "string" ? o.listing_stage : null,
            fulfillment_stage: typeof o.fulfillment_stage === "string" ? o.fulfillment_stage : null,
            metadata: o.metadata ?? {},
          };
        }
        loaded.push({
          id: String(r.id ?? id),
          title: typeof r.title === "string" && r.title.trim() ? r.title.trim() : "Pièce",
          intake,
        });
      }
      return loaded;
    };

    let currentRows = silent ? rowsRef.current : await loadRows();
    if (!silent) setRows(currentRows);

    let memberShipId = currentRows
      .map((r) => readMemberIntakeShipmentIdFromMetadata(r.intake?.metadata ?? null))
      .find((id): id is string => Boolean(id));

    if (itemIds.length > 0) {
      try {
        await fetch("/api/items/sendcloud/return-portal/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ item_ids: itemIds }),
        });
      } catch {
        /* ignore */
      }

      const refreshed = await loadRows();
      if (refreshed.length > 0) {
        setRows(refreshed);
        currentRows = refreshed;
        memberShipId =
          refreshed
            .map((r) => readMemberIntakeShipmentIdFromMetadata(r.intake?.metadata ?? null))
            .find((id): id is string => Boolean(id)) ?? memberShipId;
      }
    }

    const activeShipId = await resolveActiveMemberIntakeShipmentIdForItems(
      supabase,
      itemIds,
      memberShipId ?? null,
    );
    setMemberIntakeShipmentActive(Boolean(activeShipId));

    if (activeShipId) {
      const { data: shipRow } = await supabase
        .from("shipments")
        .select("tracking_number, member_tracking_url")
        .eq("id", activeShipId)
        .eq("context", "member_intake")
        .is("deleted_at", null)
        .maybeSingle();
      setMemberIntakeDbTracking(
        resolveIntakeTrackingHref(
          typeof shipRow?.tracking_number === "string" ? shipRow.tracking_number : null,
          typeof shipRow?.member_tracking_url === "string" ? shipRow.member_tracking_url : null,
        ),
      );
    } else {
      setMemberIntakeDbTracking(null);
    }

    if (!silent) setIsLoading(false);
  }, [itemIds]);

  const fetchShippingOptions = useCallback(async () => {
    if (itemIds.length === 0) {
      setOptionsLoading(false);
      return;
    }
    setOptionsLoading(true);
    try {
      const qs = new URLSearchParams({ item_ids: itemIds.join(",") });
      const res = await fetch(`/api/items/shipping/options?${qs.toString()}`, {
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as IntakeShippingOptionsSnapshot & {
        ok?: boolean;
      };
      if (res.ok && data.ok !== false) {
        const { ok: _ok, ...snapshot } = data;
        setShippingOptions(snapshot);
        if (data.piggyback?.cart_id) {
          setSelectedPiggybackCartId(data.piggyback.cart_id);
          setPiggybackConfirmChecked(true);
        } else if (data.eligible_cart_returns?.length === 1) {
          setSelectedPiggybackCartId(data.eligible_cart_returns[0]!.cartId);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setOptionsLoading(false);
    }
  }, [itemIds]);

  const rowsRef = useRef<LoadedRow[]>([]);
  rowsRef.current = rows;

  useEffect(() => {
    void fetchData();
    void fetchShippingOptions();
  }, [fetchData, fetchShippingOptions]);

  const runPortalStart = useCallback(
    async (signal?: AbortSignal, force = false) => {
      if (itemIds.length === 0) return;
      setAutoPhase("trying");
      setAutoError(null);
      setAutoDeveloperHint(null);
      try {
        const res = await fetch("/api/items/sendcloud/return-portal/start", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ item_ids: itemIds, force }),
          signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          developer_hint?: string;
          return_portal_url?: string;
        };
        if (signal?.aborted) return;
        if (res.ok && data.ok) {
          setAutoPhase("done");
          setAutoDeveloperHint(null);
          setAutoError(null);
          await fetchData();
          return;
        }
        console.error("[return-portal/start] client", {
          httpStatus: res.status,
          body: data,
        });
        setAutoPhase("failed");
        setAutoError(typeof data.error === "string" ? data.error : "Préparation impossible pour le moment.");
        setAutoDeveloperHint(typeof data.developer_hint === "string" ? data.developer_hint : null);
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setAutoPhase("failed");
        setAutoError("Préparation impossible pour le moment.");
        setAutoDeveloperHint(null);
      }
    },
    [itemIds, fetchData],
  );

  const triggerPortalStart = useCallback(() => {
    try {
      sessionStorage.removeItem(portalSessionKey(itemIds));
    } catch {
      /* ignore */
    }
    generationAbortRef.current?.abort();
    const ac = new AbortController();
    generationAbortRef.current = ac;
    void runPortalStart(ac.signal, false);
  }, [runPortalStart, itemIds]);

  const resetPortal = useCallback(async () => {
    setAutoPhase("trying");
    setAutoError(null);
    setAutoDeveloperHint(null);
    try {
      sessionStorage.removeItem(portalSessionKey(itemIds));
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch("/api/items/sendcloud/return-portal/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ item_ids: itemIds }),
      });
      if (!res.ok) {
        setAutoPhase("failed");
        setAutoError("Nouveau bordereau impossible pour le moment.");
        return;
      }
      setMemberIntakeDbTracking(null);
      generationAbortRef.current?.abort();
      const ac = new AbortController();
      generationAbortRef.current = ac;
      await runPortalStart(ac.signal, false);
    } catch {
      setAutoPhase("failed");
      setAutoError("Nouveau bordereau impossible pour le moment.");
    }
  }, [itemIds, runPortalStart]);

  const handleNewBordereau = useCallback(() => {
    setNewBordereauShimmer(true);
    void resetPortal().finally(() => {
      window.setTimeout(() => setNewBordereauShimmer(false), 2900);
    });
  }, [resetPortal]);

  const handleUngroupShipment = useCallback(async () => {
    const primary = [...itemIds].sort((a, b) => a.localeCompare(b))[0];
    if (!primary) return;
    setUngroupPhase("saving");
    setAutoError(null);
    try {
      const res = await fetch("/api/items/shipping/ungroup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ item_ids: itemIds }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) {
        setAutoError(data.error ?? "Séparation impossible pour le moment.");
        setUngroupPhase("idle");
        return;
      }
      router.replace(`/items/shipping?ids=${encodeURIComponent(primary)}&solo=1`);
      router.refresh();
    } catch {
      setAutoError("Séparation impossible pour le moment.");
    }
    setUngroupPhase("idle");
  }, [itemIds, router]);

  const handleGroupShipment = useCallback(async () => {
    const fromRegroup = [...(shippingOptions?.regroup_target_item_ids ?? [])]
      .map((id) => id.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const fromHref = parseItemIdsFromIntakeShippingPageHref(shippingOptions?.merge_intake_shipping_href);
    const groupIds =
      fromRegroup.length >= 2
        ? fromRegroup
        : fromHref.length >= 2
          ? fromHref
          : [...(shippingOptions?.default_shipping_group_ids ?? [])]
              .map((id) => id.trim())
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b));
    if (groupIds.length < 2) return;
    setGroupPhase("saving");
    setAutoError(null);
    try {
      const res = await fetch("/api/items/shipping/ack-group", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ item_ids: groupIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        item_ids?: string[];
      };
      if (!res.ok || data.ok === false) {
        setAutoError(data.error ?? "Regroupement impossible pour le moment.");
        setGroupPhase("idle");
        return;
      }
      const redirectIds = (
        Array.isArray(data.item_ids) && data.item_ids.length >= 2 ? data.item_ids : groupIds
      )
        .map((id) => id.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      router.replace(buildIntakeShippingPageHrefFromIds(redirectIds));
      router.refresh();
    } catch {
      setAutoError("Regroupement impossible pour le moment.");
    }
    setGroupPhase("idle");
  }, [
    router,
    shippingOptions?.default_shipping_group_ids,
    shippingOptions?.merge_intake_shipping_href,
    shippingOptions?.regroup_target_item_ids,
  ]);

  const piggybackActive =
    shippingOptions?.shipping_mode === SC_SHIPPING_MODE_CART_RETURN_PIGGYBACK &&
    Boolean(shippingOptions.piggyback?.cart_id);

  const expeditionMode = useMemo(() => {
    if (rows.length === 0 || rows.length !== itemIds.length) return false;
    return rows.every(
      (r) =>
        r.intake?.listing_stage === "validated" &&
        String(r.intake?.fulfillment_stage ?? "").trim().toLowerCase() === "shipping",
    );
  }, [rows, itemIds.length]);

  const intakeLabelTracking = useMemo(() => {
    const meta = parseIntakeShippingLabelFromMetadata(rows[0]?.intake?.metadata ?? null);
    return resolveIntakeTrackingHref(meta?.numero_suivi, meta?.lien_suivi);
  }, [rows]);

  const prepareTracking = useMemo(() => {
    if (memberIntakeDbTracking?.trackingNumber || memberIntakeDbTracking?.trackingHref) {
      return memberIntakeDbTracking;
    }
    if (memberIntakeShipmentActive) {
      const soloSplitAwaitingLabel = rows.some((r) => readShippingPreferSolo(r.intake?.metadata ?? null));
      if (!soloSplitAwaitingLabel && isIntakeMemberReturnTrackingNumber(intakeLabelTracking.trackingNumber)) {
        return intakeLabelTracking;
      }
      return { trackingNumber: null, trackingHref: null };
    }
    return intakeLabelTracking;
  }, [memberIntakeDbTracking, intakeLabelTracking, memberIntakeShipmentActive, rows]);

  const returnCreated = useMemo(
    () => isIntakeMemberReturnTrackingNumber(prepareTracking.trackingNumber),
    [prepareTracking.trackingNumber],
  );

  const expeditionTracking = useMemo(() => {
    if (returnShipmentTracking?.trackingNumber || returnShipmentTracking?.trackingHref) {
      return returnShipmentTracking;
    }
    return intakeLabelTracking;
  }, [returnShipmentTracking, intakeLabelTracking]);

  useEffect(() => {
    if (!expeditionMode || !piggybackActive) {
      setReturnShipmentTracking(null);
      return;
    }
    const piggy = readIntakePiggybackFromMetadata(rows[0]?.intake?.metadata);
    if (!piggy.shipmentId) return;
    if (intakeLabelTracking.trackingNumber || intakeLabelTracking.trackingHref) return;

    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
      const supabase = createSupabaseBrowserClient() as any;
      const { data } = await supabase
        .from("shipments")
        .select("tracking_number, member_tracking_url")
        .eq("id", piggy.shipmentId)
        .maybeSingle();
      if (cancelled) return;
      const resolved = resolveIntakeTrackingHref(
        typeof data?.tracking_number === "string" ? data.tracking_number : null,
        typeof data?.member_tracking_url === "string" ? data.member_tracking_url : null,
      );
      setReturnShipmentTracking(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [expeditionMode, piggybackActive, rows, intakeLabelTracking.trackingHref, intakeLabelTracking.trackingNumber]);

  const confirmPiggyback = useCallback(async () => {
    if (!selectedPiggybackCartId || !piggybackConfirmChecked) return;
    setPiggybackPhase("saving");
    setPiggybackError(null);
    try {
      const res = await fetch("/api/items/shipping/piggyback-cart-return", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ item_ids: itemIds, cart_id: selectedPiggybackCartId }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setPiggybackPhase("error");
        setPiggybackError(typeof data.error === "string" ? data.error : "Enregistrement impossible.");
        return;
      }
      setPiggybackPhase("idle");
      await Promise.all([fetchData(), fetchShippingOptions()]);
    } catch {
      setPiggybackPhase("error");
      setPiggybackError("Enregistrement impossible.");
    }
  }, [itemIds, selectedPiggybackCartId, piggybackConfirmChecked, fetchData, fetchShippingOptions]);

  const revertToReturnPortal = useCallback(async () => {
    setPiggybackPhase("saving");
    setPiggybackError(null);
    try {
      const res = await fetch("/api/items/shipping/piggyback-cart-return", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ item_ids: itemIds, use_return_portal: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setPiggybackPhase("error");
        setPiggybackError(typeof data.error === "string" ? data.error : "Réinitialisation impossible.");
        return;
      }
      setPiggybackConfirmChecked(false);
      setSelectedPiggybackCartId(null);
      setPiggybackPhase("idle");
      try {
        sessionStorage.removeItem(portalSessionKey(itemIds));
      } catch {
        /* ignore */
      }
      await Promise.all([fetchData(), fetchShippingOptions()]);
      generationAbortRef.current?.abort();
      const ac = new AbortController();
      generationAbortRef.current = ac;
      void runPortalStart(ac.signal, false);
    } catch {
      setPiggybackPhase("error");
      setPiggybackError("Réinitialisation impossible.");
    }
  }, [itemIds, fetchData, fetchShippingOptions, runPortalStart]);

  useEffect(() => {
    if (isLoading || optionsLoading || itemIds.length === 0) return;
    if (expeditionMode) {
      setAutoPhase("skipped");
      return;
    }
    if (piggybackActive) {
      setAutoPhase("skipped");
      return;
    }
    const curRows = rowsRef.current;
    const complete = curRows.length === itemIds.length && curRows.length > 0;
    const shippingReady =
      complete &&
      curRows.every(
        (r) =>
          r.intake?.listing_stage === "validated" &&
          ["ready", "shipping"].includes(
            String(r.intake?.fulfillment_stage ?? "").trim().toLowerCase(),
          ),
      );
    if (!shippingReady) {
      setAutoPhase((prev) => (prev === "trying" || prev === "failed" ? prev : "skipped"));
      return;
    }

    if (isIntakeMemberReturnTrackingNumber(memberIntakeDbTracking?.trackingNumber)) {
      setAutoPhase("done");
      return;
    }

    if (
      !memberIntakeShipmentActive &&
      curRows.some((r) => {
        const meta = parseIntakeShippingLabelFromMetadata(r.intake?.metadata ?? null);
        return isIntakeMemberReturnTrackingNumber(meta?.numero_suivi);
      })
    ) {
      setAutoPhase("done");
      return;
    }

    const { portalReady: existingReady, portalExpired: existingExpired } = pickPortalFromRows(curRows);
    if (existingReady && !existingExpired) {
      setAutoPhase("done");
      return;
    }

    const storedError = readStoredSendcloudError(curRows);
    if (storedError) {
      setAutoPhase("failed");
      setAutoError(storedError);
      return;
    }

    const sessionKey = portalSessionKey(itemIds);
    try {
      const { portalReady: sessionPortalReady, portalExpired: sessionPortalExpired } =
        pickPortalFromRows(curRows);
      if (sessionStorage.getItem(sessionKey) === "1") {
        if (sessionPortalReady && !sessionPortalExpired) {
          setAutoPhase("skipped");
          return;
        }
        sessionStorage.removeItem(sessionKey);
      }
      sessionStorage.setItem(sessionKey, "1");
    } catch {
      /* sessionStorage indisponible */
    }

    const ac = new AbortController();
    generationAbortRef.current?.abort();
    generationAbortRef.current = ac;
    void runPortalStart(ac.signal, false);
    return () => {
      ac.abort();
    };
  }, [isLoading, optionsLoading, itemIdsKey, runPortalStart, piggybackActive, expeditionMode, memberIntakeDbTracking?.trackingNumber, memberIntakeShipmentActive]);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [headerTitleProp, rows]);

  const headerTitle = useMemo(() => {
    if (expeditionMode) return "Expédition";
    const t = headerTitleProp?.trim();
    if (t) return t;
    return rows[0]?.title ?? "Envoi";
  }, [expeditionMode, headerTitleProp, rows]);

  const { portalUrl, labelUrl, portalExpired, orderNumber, postalCode, intake } = useMemo(
    () => pickPortalFromRows(rows),
    [rows],
  );
  const inVerification = intake?.fulfillment_stage === "in_verification";

  const awaitingReturnTracking = useMemo(() => {
    if (isLoading || optionsLoading || expeditionMode || piggybackActive) return false;
    if (returnCreated) return false;
    const { portalReady, portalExpired: expired, labelUrl: portalLabelUrl } = pickPortalFromRows(rows);
    if (portalLabelUrl?.startsWith("http")) return false;
    return (portalReady && !expired) || Boolean(portalUrl?.trim());
  }, [
    isLoading,
    optionsLoading,
    expeditionMode,
    piggybackActive,
    returnCreated,
    rows,
    portalUrl,
  ]);

  useEffect(() => {
    if (!awaitingReturnTracking) return;
    const poll = () => void fetchData({ silent: true });
    const interval = window.setInterval(poll, 4000);
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [awaitingReturnTracking, fetchData]);

  const requestHelp = useCallback(async (message = "") => {
    setHelpPhase("sending");
    try {
      const res = await fetch("/api/items/sendcloud/help-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ item_ids: itemIds, message }),
      });
      if (res.ok) {
        setHelpPhase("sent");
        await fetchData();
      } else {
        setHelpPhase("error");
      }
    } catch {
      setHelpPhase("error");
    }
  }, [itemIds, fetchData]);
  const plural = itemIds.length > 1;

  const portalHref = portalUrl?.trim() ?? "";
  const labelHref = labelUrl?.trim() ?? "";
  const showPortalCta = Boolean(portalHref && !labelHref && !returnCreated);
  const showPortalExpired = portalExpired && !labelHref && !returnCreated;

  const pageSubtitle = useMemo(() => {
    if (isLoading) return "Chargement…";
    if (expeditionMode) {
      return piggybackActive
        ? "Ta pièce voyage avec ton retour d’échange."
        : "Ton colis est en route vers Segna.";
    }
    if (piggybackActive) {
      return "Tu envoies ta pièce avec le retour d’un échange en cours.";
    }
    if (returnCreated) {
      const names = rows.map((r) => r.title.trim()).filter(Boolean);
      if (names.length === 1) return `Expédie ${names[0]}`;
      if (names.length > 1) return `Expédie ${names.join(", ")}`;
      return "Expédie ma pièce";
    }
    if (labelHref) return "Ton étiquette retour est prête.";
    if (showPortalExpired) return "Ton accès au portail a expiré.";
    if (showPortalCta) return "Imprime ton bordereau d’envoi sur le portail Sendcloud.";
    if (portalHref) return "Chrono 2Shop Retour — crée ton étiquette.";
    if (inVerification) return "Colis reçu — vérification en cours.";
    if (autoPhase === "trying") return "Préparation de ton envoi…";
    if (autoPhase === "failed") return "Une action est nécessaire.";
    if (autoPhase === "skipped") return "Ouvre le portail pour créer ton étiquette retour.";
    return "Envoi en préparation.";
  }, [isLoading, expeditionMode, piggybackActive, returnCreated, labelHref, showPortalCta, showPortalExpired, portalHref, inVerification, autoPhase, rows]);

  const prepareHint = useMemo(() => {
    if (isLoading) return "Chargement…";
    if (piggybackActive && shippingOptions?.piggyback) {
      return `Glisse ta pièce dans la pochette retour de l’échange ${shippingOptions.piggyback.order_number_compact} si tu as de la place, puis dépose le colis au relais comme d’habitude. Segna la récupérera avec ton retour.`;
    }
    if (returnCreated) {
      return "Imprime ton étiquette si besoin, puis dépose ton colis au relais. Tu peux suivre l’acheminement avec le numéro ci-dessous.";
    }
    if (labelHref) {
      return "Imprime l’étiquette, colle-la sur ton colis et dépose-le au relais choisi.";
    }
    if (showPortalExpired) {
      return `L’expédition technique a été annulée après ${PORTAL_VALID_MINUTES} minutes. Utilise « Nouveau Bordereau » pour rouvrir le portail.`;
    }
    if (showPortalCta) {
      const base = `Ouvre le portail, choisis ton point relais Chronopost et imprime ton bordereau d’envoi (lien valable ${PORTAL_VALID_MINUTES} minutes).`;
      if (plural && rows.length > 0) {
        return `Un seul colis pour toutes les pièces. ${base}`;
      }
      return base;
    }
    if (portalHref) {
      return "Ouvre le portail Sendcloud pour finaliser ton envoi.";
    }
    if (autoPhase === "trying") {
      return "Préparation du lien vers le portail d’envoi…";
    }
    if (autoPhase === "failed") {
      return "Corrige le point bloquant ci-dessous, ou lance un nouveau bordereau.";
    }
    return "Nous préparons ton accès au portail Sendcloud pour générer l’étiquette retour vers Segna.";
  }, [isLoading, piggybackActive, shippingOptions, returnCreated, labelHref, showPortalCta, showPortalExpired, portalHref, autoPhase, plural, rows.length]);

  const goBack = () => {
    if (backHref.startsWith("/")) {
      router.push(backHref);
    } else {
      router.back();
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-white">
      <header
        ref={headerRef}
        className="fixed left-1/2 top-0 z-[60] w-full max-w-[430px] -translate-x-1/2 border-b border-zinc-200 bg-white"
      >
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={goBack}
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900"
              aria-label={backLabel}
            >
              <ChevronLeft className="h-8 w-8" strokeWidth={2.25} />
            </button>
            <span className="h-12 w-12 shrink-0" aria-hidden />
          </div>
          <h1 className={cn("mt-5", playfair.className, SEGNA_SECTION_TITLE_CLASSNAME)}>{headerTitle}</h1>
          <p className={cn(montserrat.className, "mt-1.5 text-[17px] font-medium leading-snug text-zinc-600")}>
            {pageSubtitle}
          </p>
        </div>
      </header>

      <div
        className="mx-auto w-full max-w-[430px] shrink-0 bg-white"
        style={{ height: headerHeight }}
        aria-hidden
      />

      <div
        className="mx-auto flex w-full max-w-[430px] flex-1 flex-col bg-white"
      >
        {plural && rows.length > 0 ? (
          <section className="bg-white px-5 pb-6 pt-8">
            <h2 className={cn(playfair.className, SEGNA_SECTION_TITLE_CLASSNAME, "text-[20px]")}>
              Dans cet envoi
            </h2>
            <ul className="mt-4 space-y-3">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/items/${encodeURIComponent(row.id)}`}
                    className={cn(
                      montserrat.className,
                      "text-[15px] font-semibold text-zinc-900 underline-offset-2 hover:underline",
                    )}
                  >
                    {row.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          className={cn(
            "flex min-h-0 flex-1 flex-col bg-white",
            expeditionMode ? "pb-8" : "px-5 pb-8 pt-8",
          )}
        >
          {expeditionMode ? (
            <IntakeShippingExpeditionSection
              statusLine={
                piggybackActive
                  ? "Ta pièce voyage avec ton retour d’échange jusqu’à Segna."
                  : "En route vers Segna."
              }
              detailLine={
                piggybackActive && shippingOptions?.piggyback
                  ? `Envoi mutualisé avec l’échange ${shippingOptions.piggyback.order_number_compact}.`
                  : null
              }
              trackingNumber={expeditionTracking.trackingNumber}
              trackingHref={expeditionTracking.trackingHref}
              piggybackOrderCompact={shippingOptions?.piggyback?.order_number_compact ?? null}
              returnHref={shippingOptions?.piggyback?.return_href ?? null}
            />
          ) : (
            <>
          <h2 className={cn(playfair.className, SEGNA_SECTION_TITLE_CLASSNAME, "text-[20px]")}>
            Prépare ton envoi
          </h2>
          <p className={cn(montserrat.className, "mt-2 text-[14px] font-medium leading-snug text-zinc-600")}>
            {prepareHint}
          </p>

          {piggybackActive && shippingOptions?.piggyback ? (
            <div className={cn(montserrat.className, "mt-6 space-y-4")}>
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-200/90 bg-emerald-50 px-4 py-3.5">
                <Package className="mt-0.5 h-5 w-5 shrink-0 text-emerald-900" aria-hidden />
                <p className="text-[14px] font-medium leading-snug text-emerald-950">
                  Envoi mutualisé avec la commande{" "}
                  <span className="font-mono font-semibold">{shippingOptions.piggyback.order_number_compact}</span>.
                  Pas d’étiquette séparée : ta pièce voyage dans la pochette retour de l’échange.
                </p>
              </div>
              <Link
                href={shippingOptions.piggyback.return_href}
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900",
                )}
              >
                Voir mon retour d’échange
              </Link>
              <button
                type="button"
                onClick={() => void revertToReturnPortal()}
                disabled={piggybackPhase === "saving"}
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-900 disabled:opacity-50",
                )}
              >
                {piggybackPhase === "saving" ? "Mise à jour…" : "Pas assez de place (bordereau dédié)"}
              </button>
              {piggybackError ? (
                <p className="text-center text-[13px] font-medium text-rose-600">{piggybackError}</p>
              ) : null}
            </div>
          ) : null}

          {!piggybackActive && returnCreated ? (
            <div className={cn(montserrat.className, "mt-6 space-y-4")}>
              {labelHref ? (
                <a
                  href={labelHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    montserrat.className,
                    "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900",
                  )}
                >
                  Télécharger mon étiquette
                  <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                </a>
              ) : prepareTracking.trackingHref ? (
                <a
                  href={prepareTracking.trackingHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    montserrat.className,
                    "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900",
                  )}
                >
                  Suivre mon colis
                  <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                </a>
              ) : null}
              <IntakeNewBordereauButton
                onClick={handleNewBordereau}
                shimmer={newBordereauShimmer}
                disabled={autoPhase === "trying"}
              />
            </div>
          ) : !piggybackActive && labelHref ? (
            <div className={cn(montserrat.className, "mt-6 space-y-4")}>
              <a
                href={labelHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900",
                )}
              >
                Télécharger mon étiquette
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
              </a>
              {orderNumber ? (
                <p className="text-center text-[13px] font-medium text-zinc-600">
                  N° commande : <span className="font-mono font-semibold text-zinc-900">{orderNumber}</span>
                  {postalCode ? ` · CP ${postalCode}` : ""}
                </p>
              ) : null}
              <IntakeNewBordereauButton
                onClick={handleNewBordereau}
                shimmer={newBordereauShimmer}
                disabled={autoPhase === "trying"}
              />
              <button
                type="button"
                onClick={() =>
                  void requestHelp(
                    "Problème avec l’étiquette retour (téléchargement, relais, ou besoin d’aide côté Segna).",
                  )
                }
                disabled={helpPhase === "sending" || helpPhase === "sent"}
                className="flex w-full items-center justify-center gap-2 text-center text-[14px] font-semibold text-zinc-900 underline underline-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
              >
                <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden />
                {helpPhase === "sending"
                  ? "Envoi…"
                  : helpPhase === "sent"
                    ? "Demande envoyée"
                    : "Problème avec l’étiquette ? Contacter Segna"}
              </button>
              {helpPhase === "error" ? (
                <p className="text-center text-[13px] font-medium text-rose-600">Réessaie plus tard ou écris-nous.</p>
              ) : null}
              {helpPhase === "sent" ? (
                <p className="text-center text-[13px] font-medium text-zinc-500">L’équipe traite ta demande.</p>
              ) : null}
            </div>
          ) : !piggybackActive && showPortalExpired ? (
            <div className={cn(montserrat.className, "mt-6 space-y-4")}>
              <p
                className={cn(
                  montserrat.className,
                  "rounded-2xl border border-amber-200/90 bg-amber-50 px-4 py-3 text-[14px] font-medium leading-snug text-amber-950",
                )}
              >
                Ton lien portail n’est plus actif ({PORTAL_VALID_MINUTES} minutes écoulées). L’expédition
                technique a été annulée chez Sendcloud.
              </p>
              <IntakeNewBordereauButton
                onClick={handleNewBordereau}
                shimmer={newBordereauShimmer}
                variant="primary"
                disabled={autoPhase === "trying"}
              />
            </div>
          ) : !piggybackActive && showPortalCta ? (
            <div className={cn(montserrat.className, "mt-6 space-y-4")}>
              <a
                href={portalHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900",
                )}
              >
                Imprimer Bordereau d&apos;envoi
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
              </a>
              {orderNumber ? (
                <p className="text-center text-[13px] font-medium text-zinc-600">
                  N° commande : <span className="font-mono font-semibold text-zinc-900">{orderNumber}</span>
                  {postalCode ? ` · CP ${postalCode}` : ""}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  void requestHelp(
                    "Problème avec le portail d’envoi (lien inaccessible, erreur à l’ouverture, ou besoin d’aide côté Segna).",
                  )
                }
                disabled={helpPhase === "sending" || helpPhase === "sent"}
                className="flex w-full items-center justify-center gap-2 text-center text-[14px] font-semibold text-zinc-900 underline underline-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
              >
                <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden />
                {helpPhase === "sending"
                  ? "Envoi…"
                  : helpPhase === "sent"
                    ? "Demande envoyée"
                    : "Problème avec le portail ? Contacter Segna"}
              </button>
              {helpPhase === "error" ? (
                <p className="text-center text-[13px] font-medium text-rose-600">Réessaie plus tard ou écris-nous.</p>
              ) : null}
              {helpPhase === "sent" ? (
                <p className="text-center text-[13px] font-medium text-zinc-500">L’équipe traite ta demande.</p>
              ) : null}
            </div>
          ) : !piggybackActive && autoPhase === "trying" ? (
            <div
              className={cn(
                montserrat.className,
                "mt-6 flex items-center gap-3 rounded-2xl border border-zinc-200/90 bg-zinc-50 px-4 py-3.5 text-[14px] font-medium text-zinc-800",
              )}
            >
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-zinc-900" aria-hidden />
              <p className="leading-snug">Préparation du portail d’envoi…</p>
            </div>
          ) : !piggybackActive && autoPhase === "failed" ? (
            <div className="mt-6 space-y-3">
              <p
                className={cn(
                  montserrat.className,
                  "rounded-2xl border border-rose-200/90 bg-rose-50 px-4 py-3 text-[14px] font-medium leading-snug text-rose-950",
                )}
              >
                {(() => {
                  const msg = autoError ?? "Préparation impossible pour le moment.";
                  if (!msg.includes(PROFILE_ADDRESS_INCOMPLETE_HINT)) return msg;
                  return (
                    <>
                      Complète ton adresse dans{" "}
                      <Link
                        href={profileLocationEditHref}
                        className="font-semibold text-rose-950 underline decoration-rose-400/80 underline-offset-2 hover:decoration-rose-700"
                      >
                        ton profil
                      </Link>
                      .
                    </>
                  );
                })()}
              </p>
              {autoDeveloperHint ? (
                <div
                  className={cn(
                    montserrat.className,
                    "rounded-2xl border border-zinc-200/90 bg-zinc-100/80 px-3 py-2 text-[11px] leading-relaxed text-zinc-600",
                  )}
                >
                  <span className="font-semibold text-zinc-800">Tech : </span>
                  {autoDeveloperHint}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setHelpPhase("idle");
                  setAutoDeveloperHint(null);
                  triggerPortalStart();
                }}
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900",
                )}
              >
                Réessayer
              </button>
            </div>
          ) : !piggybackActive ? (
            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={triggerPortalStart}
                disabled={isLoading || itemIds.length === 0 || inVerification}
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                Envoyer ma pièce
              </button>
              {inVerification ? (
                <p className={cn(montserrat.className, "text-center text-[13px] font-medium text-zinc-500")}>
                  L’envoi sera proposé après la vérification de ton colis par Segna.
                </p>
              ) : null}
              <IntakeNewBordereauButton
                onClick={handleNewBordereau}
                shimmer={newBordereauShimmer}
                disabled={isLoading || autoPhase === "trying"}
              />
            </div>
          ) : null}

          {isLoading ? (
            <p className={cn(montserrat.className, "mt-4 text-[13px] font-medium text-zinc-500")}>Chargement…</p>
          ) : null}
            </>
          )}
        </section>

        {!piggybackActive && !expeditionMode ? (
        <section className="flex min-h-0 flex-1 flex-col border-t border-zinc-200 bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-8">
          <h2 className={cn(playfair.className, SEGNA_SECTION_TITLE_CLASSNAME, "text-[20px]")}>
            {groupingSectionCopy.sectionTitle}
          </h2>
          {optionsLoading ? (
            <p className={cn(montserrat.className, "mt-2 text-[14px] font-medium text-zinc-500")}>Chargement…</p>
          ) : (
            <div className="mt-5 space-y-8">
              <div>
                <h3 className={cn(playfair.className, "text-[17px] font-bold text-zinc-900")}>
                  {groupingSectionCopy.blockTitle}
                </h3>
                <p className={cn(montserrat.className, "mt-2 text-[14px] font-medium leading-snug text-zinc-600")}>
                  {groupingSectionCopy.description}
                </p>
                {!isShipmentUrlGrouped &&
                (shippingOptions?.other_intake_shipping_peers?.length ?? 0) > 0 ? (
                  <ul className={cn(montserrat.className, "mt-3 space-y-1.5 text-[14px] font-medium text-zinc-700")}>
                    {shippingOptions!.other_intake_shipping_peers.map((peer) => (
                      <li key={peer.id}>· {peer.title}</li>
                    ))}
                  </ul>
                ) : null}
                <div className={cn(montserrat.className, "mt-4 flex flex-col gap-2.5")}>
                  {isShipmentUrlGrouped ? (
                    <div className={cn(ungroupPhase === "saving" && "segna-guidance-shimmer-active")}>
                      <button
                        type="button"
                        onClick={() => void handleUngroupShipment()}
                        disabled={ungroupPhase === "saving"}
                        className={cn(
                          montserrat.className,
                          "segna-guidance-shimmer-target relative z-0 flex h-12 w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-900 transition disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                      >
                        {ungroupPhase === "saving" ? "Séparation…" : "Séparer les envois"}
                      </button>
                    </div>
                  ) : shippingOptions?.merge_intake_shipping_href ? (
                    <div className={cn(groupPhase === "saving" && "segna-guidance-shimmer-active")}>
                      <button
                        type="button"
                        onClick={() => void handleGroupShipment()}
                        disabled={groupPhase === "saving"}
                        className={cn(
                          montserrat.className,
                          "segna-guidance-shimmer-target relative z-0 flex h-12 w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-900 transition disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                      >
                        {groupPhase === "saving" ? "Regroupement…" : "Regrouper dans un seul envoi"}
                      </button>
                    </div>
                  ) : null}
                  {expandShippingHref ? (
                    <Link
                      href={expandShippingHref}
                      className="flex h-12 w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-900"
                    >
                      Ajouter une pièce à cet envoi
                    </Link>
                  ) : null}
                  {showNewPieceLink ? (
                    <Link
                      href="/items/new?fresh=1"
                      className="flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900"
                    >
                      Nouvelle pièce
                    </Link>
                  ) : null}
                </div>
              </div>

              {!piggybackActive && (shippingOptions?.eligible_cart_returns?.length ?? 0) > 0 ? (
              <div>
                <h3 className={cn(playfair.className, "text-[17px] font-bold text-zinc-900")}>
                  Retour d’échange en cours
                </h3>
                <div className="mt-4 space-y-4">
              <p className={cn(montserrat.className, "text-[14px] font-medium leading-snug text-zinc-600")}>
                Tu as un échange reçu pas encore renvoyé ? Glisse ta pièce dans la pochette retour (si tu as de la place)
                au lieu de créer une étiquette séparée.
              </p>
              <fieldset className="space-y-2">
                <legend className="sr-only">Échange à utiliser pour le retour</legend>
                {shippingOptions!.eligible_cart_returns.map((target) => (
                  <label
                    key={target.cartId}
                    className={cn(
                      montserrat.className,
                      "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3.5 transition",
                      selectedPiggybackCartId === target.cartId
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-zinc-200 bg-white",
                    )}
                  >
                    <input
                      type="radio"
                      name="piggyback_cart"
                      className="h-4 w-4 shrink-0 accent-zinc-900"
                      checked={selectedPiggybackCartId === target.cartId}
                      onChange={() => setSelectedPiggybackCartId(target.cartId)}
                    />
                    <span className="min-w-0 flex-1 text-[14px] font-semibold text-zinc-900">
                      Échange {target.orderNumberCompact}
                    </span>
                    <Link
                      href={target.returnHref}
                      className="shrink-0 text-[13px] font-semibold text-zinc-600 underline underline-offset-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Voir
                    </Link>
                  </label>
                ))}
              </fieldset>
              <label
                className={cn(
                  montserrat.className,
                  "flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3.5",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-zinc-900"
                  checked={piggybackConfirmChecked}
                  onChange={(e) => setPiggybackConfirmChecked(e.target.checked)}
                />
                <span className="text-[14px] font-medium leading-snug text-zinc-800">
                  Je confirme glisser ma pièce dans la pochette retour de cet échange, s’il y a la place.
                </span>
              </label>
              <button
                type="button"
                onClick={() => void confirmPiggyback()}
                disabled={
                  piggybackPhase === "saving" || !selectedPiggybackCartId || !piggybackConfirmChecked
                }
                className={cn(
                  montserrat.className,
                  "flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {piggybackPhase === "saving" ? "Enregistrement…" : "Envoyer avec ce retour"}
              </button>
                    {piggybackError ? (
                      <p className="text-center text-[13px] font-medium text-rose-600">{piggybackError}</p>
                    ) : null}
                  </div>
              </div>
              ) : null}
            </div>
          )}
          <div className="min-h-0 flex-1" aria-hidden />
        </section>
        ) : null}
      </div>

    </div>
  );
}
