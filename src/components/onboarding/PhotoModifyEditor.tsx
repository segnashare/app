"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.5;
/** Léger zoom initial pour débloquer le déplacement sur les deux axes quand le cover ne laisse qu'un axe libre. */
const CROP_PAN_FREEDOM_ZOOM = 1.03;

type Offset = { x: number; y: number };

type CropLayout = {
  bgWidth: number;
  bgHeight: number;
  bgLeft: number;
  bgTop: number;
  overflowX: number;
  overflowY: number;
};

function clampOffset(offset: Offset, limits: Offset): Offset {
  return {
    x: Math.min(limits.x, Math.max(-limits.x, offset.x)),
    y: Math.min(limits.y, Math.max(-limits.y, offset.y)),
  };
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(3))));
}

function computeCropLayout(
  stageWidth: number,
  stageHeight: number,
  imageRatio: number,
  zoom: number,
  offset: Offset,
): CropLayout {
  const safeWidth = Math.max(stageWidth, 1);
  const safeHeight = Math.max(stageHeight, 1);
  const stageRatio = safeWidth / safeHeight;
  const widthPercent = Math.max(100, 100 * (imageRatio / stageRatio)) * zoom;
  const bgWidth = safeWidth * (widthPercent / 100);
  const bgHeight = bgWidth / imageRatio;
  const heightPercent = widthPercent * (stageRatio / imageRatio);
  const overflowX = Math.max(0, (widthPercent - 100) / 2);
  const overflowY = Math.max(0, (heightPercent - 100) / 2);
  const bgLeft = (safeWidth - bgWidth) * (0.5 + offset.x / 100);
  const bgTop = (safeHeight - bgHeight) * (0.5 + offset.y / 100);
  return { bgWidth, bgHeight, bgLeft, bgTop, overflowX, overflowY };
}

type PhotoModifyEditorProps = {
  dataUrl: string;
  aspect: "square" | "portrait" | "landscape";
  offset: Offset;
  zoom: number;
  onOffsetChange: (next: Offset) => void;
  onZoomChange: (next: number) => void;
};

export function PhotoModifyEditor(props: PhotoModifyEditorProps) {
  return <PhotoModifyEditorImpl key={props.dataUrl} {...props} />;
}

function PhotoModifyEditorImpl({ dataUrl, aspect, offset, zoom, onOffsetChange, onZoomChange }: PhotoModifyEditorProps) {
  const [imageRatio, setImageRatio] = useState(1);
  const [bitmapReady, setBitmapReady] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDistance: number; startZoom: number } | null>(null);
  const latestOffsetRef = useRef(offset);
  const latestZoomRef = useRef(zoom);
  const autoZoomAppliedRef = useRef(false);

  useEffect(() => {
    latestOffsetRef.current = offset;
    latestZoomRef.current = zoom;
  }, [offset, zoom]);

  useEffect(() => {
    autoZoomAppliedRef.current = false;
    if (!dataUrl) return;
    setBitmapReady(false);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (width > 0 && height > 0) {
        setImageRatio(width / height);
      }
      void (async () => {
        try {
          if (typeof image.decode === "function") await image.decode();
        } catch {
          /* ignore */
        }
        setBitmapReady(true);
      })();
    };
    image.onerror = () => {
      setBitmapReady(true);
    };
    image.src = dataUrl;
  }, [dataUrl]);

  useLayoutEffect(() => {
    if (!bitmapReady) return;
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bitmapReady, aspect, dataUrl]);

  const cropLayout = useMemo(
    () =>
      computeCropLayout(
        stageSize.width,
        stageSize.height,
        imageRatio,
        zoom,
        offset,
      ),
    [stageSize.width, stageSize.height, imageRatio, zoom, offset],
  );

  const clampOffsetToLayout = (nextOffset: Offset, layoutZoom = latestZoomRef.current) => {
    const { overflowX, overflowY } = computeCropLayout(
      Math.max(stageSize.width, 1),
      Math.max(stageSize.height, 1),
      imageRatio,
      layoutZoom,
      nextOffset,
    );
    return clampOffset(nextOffset, { x: overflowX, y: overflowY });
  };

  useEffect(() => {
    if (!bitmapReady || stageSize.width <= 0 || stageSize.height <= 0) return;
    onOffsetChange(clampOffsetToLayout(latestOffsetRef.current));
  }, [bitmapReady, imageRatio, stageSize.width, stageSize.height, zoom]);

  useEffect(() => {
    if (!bitmapReady || autoZoomAppliedRef.current || stageSize.width <= 0 || stageSize.height <= 0) return;
    if (zoom !== 1) {
      autoZoomAppliedRef.current = true;
      return;
    }

    const { overflowX, overflowY } = computeCropLayout(
      stageSize.width,
      stageSize.height,
      imageRatio,
      zoom,
      latestOffsetRef.current,
    );
    const singleAxisOverflow = (overflowX === 0) !== (overflowY === 0);
    if (!singleAxisOverflow) {
      autoZoomAppliedRef.current = true;
      return;
    }

    autoZoomAppliedRef.current = true;
    onZoomChange(clampZoom(CROP_PAN_FREEDOM_ZOOM));
  }, [bitmapReady, imageRatio, onZoomChange, stageSize.width, stageSize.height, zoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = Math.sign(event.deltaY) * 0.08;
      const nextZoom = clampZoom(latestZoomRef.current - delta);
      onOffsetChange(clampOffsetToLayout(latestOffsetRef.current, nextZoom));
      onZoomChange(nextZoom);
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stage.removeEventListener("wheel", onWheel);
    };
  }, [imageRatio, onOffsetChange, onZoomChange, stageSize.width, stageSize.height]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragPointerRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!stageRef.current) return;

    const pointerValues = Array.from(activePointersRef.current.values());
    if (pointerValues.length >= 2) {
      const [a, b] = pointerValues;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (!pinchRef.current) {
        pinchRef.current = { startDistance: distance, startZoom: latestZoomRef.current };
      } else {
        const scale = distance / Math.max(pinchRef.current.startDistance, 1);
        const nextZoom = clampZoom(pinchRef.current.startZoom * scale);
        onOffsetChange(clampOffsetToLayout(latestOffsetRef.current, nextZoom));
        onZoomChange(nextZoom);
      }
      return;
    }

    if (!dragPointerRef.current) return;
    const stageWidth = Math.max(stageRef.current.clientWidth, 1);
    const stageHeight = Math.max(stageRef.current.clientHeight, 1);
    const deltaXPercent = ((event.clientX - dragPointerRef.current.x) / stageWidth) * 100;
    const deltaYPercent = ((event.clientY - dragPointerRef.current.y) / stageHeight) * 100;
    dragPointerRef.current = { x: event.clientX, y: event.clientY };

    const currentOffset = latestOffsetRef.current;
    onOffsetChange(
      clampOffsetToLayout({
        x: currentOffset.x - deltaXPercent,
        y: currentOffset.y - deltaYPercent,
      }),
    );
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (activePointersRef.current.size === 1) {
      const [remainingPointer] = Array.from(activePointersRef.current.values());
      dragPointerRef.current = { x: remainingPointer.x, y: remainingPointer.y };
      return;
    }
    dragPointerRef.current = null;
  };

  return (
    <div className="bg-white">
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden ${bitmapReady ? "bg-black" : "bg-zinc-200"} ${
          aspect === "portrait" ? "aspect-[3/4]" : aspect === "landscape" ? "aspect-[4/3]" : "aspect-square"
        }`}
      >
        {!bitmapReady ? (
          <div className="pointer-events-none absolute inset-0 z-[5]">
            <SegnaSkeletonBlock className="h-full w-full" rounded="rounded-none" />
          </div>
        ) : (
          <img
            src={dataUrl}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{
              width: cropLayout.bgWidth,
              height: cropLayout.bgHeight,
              left: cropLayout.bgLeft,
              top: cropLayout.bgTop,
            }}
          />
        )}
        <div className="absolute inset-0 bg-black/16" />

        <div
          className="absolute inset-0"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            touchAction: "none",
          }}
        />

        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={`grid-${index}`} className="border border-white/55" />
          ))}
        </div>
      </div>
    </div>
  );
}
