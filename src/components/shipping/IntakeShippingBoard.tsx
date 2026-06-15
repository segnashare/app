"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical, Package } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IntakeShippingGroupOthersSection } from "@/components/shipping/IntakeShippingGroupOthersSection";
import { IntakeShippingPageHelp } from "@/components/shipping/IntakeShippingPageHelp";
import { OuttakeReturnBordereauSection } from "@/components/shipping/OuttakeReturnBordereauSection";
import { ShippingBordereauExperience } from "@/components/shipping/ShippingBordereauExperience";
import {
  INTAKE_GROUP_MAX_ITEMS,
  type IntakeGroupSnapshot,
} from "@/lib/items/member-intake-groups.shared";
import { SEGNA_SECTION_TITLE_CLASSNAME, segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const playfair = segnaPlayfairDisplay;

const NEW_ENVOI_DROP_ID = "new-envoi";

const GLOBAL_INTAKE_PREPARE_HINT =
  "Chaque colis (max 5 pièces) part avec son propre bordereau. Glisse tes pièces pour les regrouper ou les séparer. Tu peux créer plusieurs colis.";

const GLOBAL_OUTTAKE_PREPARE_HINT =
  "Chaque colis retour (max 5 pièces) part avec son propre bordereau. Tes renvois sont regroupés automatiquement — tu peux les réorganiser ici. Pas de mutualisation avec d'autres membres.";

function applyOptimisticMove(
  groups: IntakeGroupSnapshot[],
  itemId: string,
  targetIntakeId: string | null,
): IntakeGroupSnapshot[] {
  const sourceIdx = groups.findIndex((g) => g.items.some((i) => i.id === itemId));
  if (sourceIdx < 0) return groups;

  const sourceGroup = groups[sourceIdx];
  const item = sourceGroup.items.find((i) => i.id === itemId);
  if (!item) return groups;

  const remainingSource = sourceGroup.items.filter((i) => i.id !== itemId);
  let next = groups
    .map((g, idx) => {
      if (idx !== sourceIdx) return g;
      if (remainingSource.length === 0) return null;
      return { ...g, items: remainingSource };
    })
    .filter((g): g is IntakeGroupSnapshot => g !== null);

  if (targetIntakeId) {
    next = next.map((g) =>
      g.id === targetIntakeId
        ? { ...g, items: [...g.items, { ...item, sortOrder: g.items.length }] }
        : g,
    );
  } else {
    next = [
      ...next,
      {
        id: `optimistic-${itemId}`,
        items: [{ ...item, sortOrder: 0 }],
        shipmentId: null,
        shipmentStatus: null,
        hasActiveLabel: false,
      },
    ];
  }

  return next;
}

async function fetchShippingGroups(mode: "intake" | "outtake"): Promise<IntakeGroupSnapshot[] | null> {
  try {
    const url = mode === "outtake" ? "/api/outtakes/shipping" : "/api/intakes/shipping";
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      groups?: IntakeGroupSnapshot[];
    };
    return data.ok && data.groups ? data.groups : null;
  } catch {
    return null;
  }
}

/** Résout la zone de dépôt : id envoi, id pièce (→ envoi parent), ou « nouvel envoi ». */
function resolveDropTargetId(
  overId: string | null,
  groups: IntakeGroupSnapshot[],
): string | null {
  if (!overId) return null;
  if (overId === NEW_ENVOI_DROP_ID) return NEW_ENVOI_DROP_ID;
  if (groups.some((g) => g.id === overId)) return overId;
  for (const group of groups) {
    if (group.items.some((item) => item.id === overId)) return group.id;
  }
  return null;
}

type IntakeShippingBoardProps = {
  initialGroups: IntakeGroupSnapshot[];
  highlightIntakeId?: string | null;
  backHref: string;
  logisticsMode?: "intake" | "outtake";
};

function DraggableItemChip({
  itemId,
  title,
  disabled,
  pending,
}: {
  itemId: string;
  title: string;
  disabled?: boolean;
  pending?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: itemId,
    disabled,
    data: { type: "item" as const, itemId },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, touchAction: "none" }
    : { touchAction: "none" };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        montserrat.className,
        "flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 shadow-sm select-none transition-opacity",
        isDragging && "opacity-40",
        pending && !isDragging && "opacity-70",
        disabled ? "opacity-60" : "cursor-grab touch-none active:cursor-grabbing",
      )}
      aria-label={disabled ? title : `Déplacer ${title}`}
      {...(disabled ? {} : { ...listeners, ...attributes })}
    >
      <span
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500",
          !disabled && "hover:bg-zinc-100",
        )}
        aria-hidden
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <span className="text-[14px] font-semibold text-zinc-900">{title}</span>
    </div>
  );
}

function EnvoiCard({
  group,
  index,
  highlighted,
  pendingItemIds,
  backHref,
  logisticsMode,
}: {
  group: IntakeGroupSnapshot;
  index: number;
  highlighted?: boolean;
  pendingItemIds: ReadonlySet<string>;
  backHref: string;
  logisticsMode: "intake" | "outtake";
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: group.id,
    data: { type: "envoi" as const, intakeId: group.id },
  });

  const itemIds = group.items.map((i) => i.id);
  const transferFull = group.items.length >= INTAKE_GROUP_MAX_ITEMS;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-2xl border-2 border-dashed transition-colors",
        highlighted ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-zinc-50/50",
        isOver && "border-zinc-900 bg-zinc-100",
      )}
    >
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-zinc-600" aria-hidden />
            <span className={cn(montserrat.className, "text-[13px] font-bold uppercase tracking-wide text-zinc-600")}>
              {logisticsMode === "outtake" ? "Colis retour" : "Envoi"} {index + 1}
            </span>
          </div>
          <span className={cn(montserrat.className, "text-[12px] font-medium text-zinc-900")}>
            {group.items.length}/{INTAKE_GROUP_MAX_ITEMS} pièce{group.items.length > 1 ? "s" : ""}
            {transferFull ? (
              <span className="font-normal text-zinc-500">, colis plein</span>
            ) : null}
          </span>
        </div>

        <div className="min-h-[44px] space-y-2">
          {group.items.map((item) => (
            <DraggableItemChip
              key={item.id}
              itemId={item.id}
              title={item.title}
              disabled={pendingItemIds.has(item.id)}
              pending={pendingItemIds.has(item.id)}
            />
          ))}
          {group.items.length === 0 ? (
            <p className={cn(montserrat.className, "text-[13px] font-medium text-zinc-400")}>
              Glisse une pièce ici
            </p>
          ) : transferFull ? (
            <p className={cn(montserrat.className, "text-[12px] font-medium text-zinc-500")}>
              Colis plein. Glisse une pièce ailleurs pour la déplacer.
            </p>
          ) : null}
        </div>
      </div>

      {itemIds.length > 0 ? (
        <div className="border-t border-zinc-200/90 bg-white px-4 pb-4">
          {logisticsMode === "outtake" ? (
            <OuttakeReturnBordereauSection
              transferId={group.id}
              itemIds={itemIds}
              hasActiveLabel={group.hasActiveLabel}
              existingLabelUrl={group.labelUrl ?? null}
              existingTracking={group.trackingNumber ?? null}
            />
          ) : (
            <ShippingBordereauExperience
              backHref={backHref}
              itemIds={itemIds}
              hideHeader
              embeddedInEnvoi
              hideHelpLinks
              preferredShipmentId={group.shipmentId}
              preferredShipmentStatus={group.shipmentStatus}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function NewEnvoiDropZone({ logisticsMode }: { logisticsMode: "intake" | "outtake" }) {
  const { isOver, setNodeRef } = useDroppable({
    id: NEW_ENVOI_DROP_ID,
    data: { type: "new-envoi" as const },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        montserrat.className,
        "flex min-h-[72px] items-center justify-center rounded-2xl border-2 border-dashed px-4 py-5 text-center text-[14px] font-semibold transition-colors",
        isOver ? "border-zinc-900 bg-zinc-100 text-zinc-900" : "border-zinc-300 text-zinc-500",
      )}
    >
      Glisse une pièce ici pour créer un nouveau {logisticsMode === "outtake" ? "colis retour" : "envoi"}
    </div>
  );
}

type MoveJob = {
  itemId: string;
  targetIntakeId: string | null;
};

export function IntakeShippingBoard({
  initialGroups,
  highlightIntakeId,
  backHref,
  logisticsMode = "intake",
}: IntakeShippingBoardProps) {
  const [groups, setGroups] = useState(initialGroups);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(() => new Set());
  const [moveError, setMoveError] = useState<string | null>(null);

  const moveQueueRef = useRef<MoveJob[]>([]);
  const processingMoveRef = useRef(false);
  const pendingCountRef = useRef(0);

  useEffect(() => {
    if (pendingCountRef.current === 0) {
      setGroups(initialGroups);
    }
  }, [initialGroups]);

  const syncPendingItemIds = useCallback(() => {
    setPendingItemIds(new Set(moveQueueRef.current.map((j) => j.itemId)));
  }, []);

  const processMoveQueue = useCallback(async () => {
    if (processingMoveRef.current) return;
    processingMoveRef.current = true;

    while (moveQueueRef.current.length > 0) {
      const job = moveQueueRef.current[0];
      try {
        const res = await fetch(logisticsMode === "outtake" ? "/api/outtakes/move-item" : "/api/intakes/move-item", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(
            logisticsMode === "outtake"
              ? { item_id: job.itemId, target_transfer_id: job.targetIntakeId }
              : { item_id: job.itemId, target_intake_id: job.targetIntakeId },
          ),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          groups?: IntakeGroupSnapshot[];
          error?: string;
        };

        if (!data.ok || !data.groups) {
          setMoveError(data.error ?? "Impossible de déplacer cette pièce.");
          moveQueueRef.current = [];
          pendingCountRef.current = 0;
          syncPendingItemIds();
          const fresh = await fetchShippingGroups(logisticsMode);
          if (fresh) setGroups(fresh);
          break;
        }

        setGroups(data.groups);
      } catch {
        setMoveError("Erreur réseau. Réessaie dans un instant.");
        moveQueueRef.current = [];
        pendingCountRef.current = 0;
        syncPendingItemIds();
        const fresh = await fetchShippingGroups(logisticsMode);
        if (fresh) setGroups(fresh);
        break;
      }

      moveQueueRef.current.shift();
      pendingCountRef.current = moveQueueRef.current.length;
      syncPendingItemIds();
    }

    processingMoveRef.current = false;
  }, [logisticsMode, syncPendingItemIds]);

  const intakeGroupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);

  const allItemIds = useMemo(
    () => [...new Set(groups.flatMap((g) => g.items.map((i) => i.id)))],
    [groups],
  );

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const pointerHits = pointerWithin(args);
      if (pointerHits.length > 0) {
        const envoiHit = pointerHits.find((hit) => {
          const id = String(hit.id);
          return id === NEW_ENVOI_DROP_ID || intakeGroupIds.has(id);
        });
        if (envoiHit) return [envoiHit];
        return pointerHits;
      }
      return closestCenter(args);
    },
    [intakeGroupIds],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const itemById = useMemo(() => {
    const map = new Map<string, { title: string; intakeId: string }>();
    for (const group of groups) {
      for (const item of group.items) {
        map.set(item.id, { title: item.title, intakeId: group.id });
      }
    }
    return map;
  }, [groups]);

  const activeItem = activeItemId ? itemById.get(activeItemId) : null;
  const multipleEnvois = groups.length > 1;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setMoveError(null);
    setActiveItemId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveItemId(null);
      const itemId = String(event.active.id);
      const rawOverId = event.over ? String(event.over.id) : null;
      const dropTargetId = resolveDropTargetId(rawOverId, groups);
      const sourceIntakeId = itemById.get(itemId)?.intakeId ?? null;

      if (!dropTargetId || dropTargetId === sourceIntakeId) return;
      if (pendingItemIds.has(itemId)) return;

      const targetIntakeId = dropTargetId === NEW_ENVOI_DROP_ID ? null : dropTargetId;
      if (targetIntakeId) {
        const target = groups.find((g) => g.id === targetIntakeId);
        if (target && target.items.length >= INTAKE_GROUP_MAX_ITEMS) {
          setMoveError(
            `Ce colis est plein (${INTAKE_GROUP_MAX_ITEMS} pièces max). Glisse vers un autre colis ou crée un nouvel envoi.`,
          );
          return;
        }
      }

      setMoveError(null);
      setGroups((prev) => applyOptimisticMove(prev, itemId, targetIntakeId));

      moveQueueRef.current.push({ itemId, targetIntakeId });
      pendingCountRef.current = moveQueueRef.current.length;
      syncPendingItemIds();
      void processMoveQueue();
    },
    [groups, itemById, pendingItemIds, processMoveQueue, syncPendingItemIds],
  );

  if (groups.length === 0) {
    return (
      <div className={cn(montserrat.className, "px-5 py-12 text-center text-[15px] font-medium text-zinc-600")}>
        Aucune pièce à envoyer pour le moment.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={(e) => void handleDragEnd(e)}
    >
      <section className="bg-white px-5 pb-4 pt-8">
        <h2 className={cn(playfair.className, SEGNA_SECTION_TITLE_CLASSNAME, "text-[20px]")}>
          {logisticsMode === "outtake" ? "Prépare tes retours" : "Prépare ton envoi"}
        </h2>
        <p className={cn(montserrat.className, "mt-2 text-[14px] font-medium leading-snug text-zinc-600")}>
          {logisticsMode === "outtake" ? GLOBAL_OUTTAKE_PREPARE_HINT : GLOBAL_INTAKE_PREPARE_HINT}
        </p>

        {moveError ? (
          <p className={cn(montserrat.className, "mt-3 text-[13px] font-medium text-rose-600")}>{moveError}</p>
        ) : null}

        {multipleEnvois ? (
          <h3
            className={cn(
              montserrat.className,
              "mt-6 text-[12px] font-bold uppercase tracking-wide text-zinc-500",
            )}
          >
            Tes {logisticsMode === "outtake" ? "colis retour" : "envois"}
          </h3>
        ) : null}

        <div className={cn("space-y-4", multipleEnvois ? "mt-3" : "mt-5")}>
          {groups.map((group, index) => (
            <EnvoiCard
              key={group.id}
              group={group}
              index={index}
              highlighted={highlightIntakeId === group.id}
              pendingItemIds={pendingItemIds}
              backHref={backHref}
              logisticsMode={logisticsMode}
            />
          ))}
          <NewEnvoiDropZone logisticsMode={logisticsMode} />
        </div>
      </section>

      {logisticsMode === "intake" ? (
        <>
          <IntakeShippingGroupOthersSection boardItemIds={allItemIds} />
          <IntakeShippingPageHelp itemIds={allItemIds} />
        </>
      ) : null}

      <DragOverlay dropAnimation={null} zIndex={80}>
        {activeItem ? (
          <div
            className={cn(
              montserrat.className,
              "rounded-xl border border-zinc-300 bg-white px-4 py-3 text-[14px] font-semibold text-zinc-900 shadow-lg",
            )}
            style={{ touchAction: "none" }}
          >
            {activeItem.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
