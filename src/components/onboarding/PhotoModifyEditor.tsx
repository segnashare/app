"use client";

import { useEffect, useRef, useState } from "react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.5;

type Offset = { x: number; y: number };

function clampOffset(offset: Offset, limits: Offset): Offset {
  return {
    x: Math.min(limits.x, Math.max(-limits.x, offset.x)),
    y: Math.min(limits.y, Math.max(-limits.y, offset.y)),
  };
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(3))));
}

type PhotoModifyEditorProps = {
  dataUrl: string;
  aspect: "square" | "portrait";
  offset: Offset;
  zoom: number;
  onOffsetChange: (next: Offset) => void;
  onZoomChange: (next: number) => void;
};

export function PhotoModifyEditor({ dataUrl, aspect, offset, zoom, onOffsetChange, onZoomChange }: PhotoModifyEditorProps) {
  const [imageRatio, setImageRatio] = useState(1);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDistance: number; startZoom: number } | null>(null);
  const latestOffsetRef = useRef(offset);
  const latestZoomRef = useRef(zoom);

  useEffect(() => {
    latestOffsetRef.current = offset;
    latestZoomRef.current = zoom;
  }, [offset, zoom]);

  useEffect(() => {
    if (!dataUrl) return;
    const image = new Image();
    image.onload = () => {
      if (image.width > 0 && image.height > 0) {
        setImageRatio(image.width / image.height);
      }
    };
    image.src = dataUrl;
  }, [dataUrl]);

  const computeCoverGeometry = () => {
    if (!stageRef.current) {
      return { baseWidthPercent: 100, overflowX: 0, overflowY: 0 };
    }
    const stageWidth = Math.max(stageRef.current.clientWidth, 1);
    const stageHeight = Math.max(stageRef.current.clientHeight, 1);
    const stageRatio = stageWidth / stageHeight;
    const baseWidthPercent = Math.max(100, 100 * (imageRatio / stageRatio));
    const widthPercent = baseWidthPercent * zoom;
    const heightPercent = widthPercent * (stageRatio / imageRatio);
    const overflowX = Math.max(0, (widthPercent - 100) / 2);
    const overflowY = Math.max(0, (heightPercent - 100) / 2);
    return { baseWidthPercent, overflowX, overflowY };
  };

  useEffect(() => {
    const { overflowX, overflowY } = computeCoverGeometry();
    onOffsetChange(clampOffset(offset, { x: overflowX, y: overflowY }));
  }, [zoom, imageRatio]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = Math.sign(event.deltaY) * 0.08;
      const next = clampZoom(latestZoomRef.current - delta);
      const stageRatio = stage.clientWidth / Math.max(stage.clientHeight, 1);
      const baseWidthPercent = Math.max(100, 100 * (imageRatio / stageRatio));
      const widthPercent = baseWidthPercent * next;
      const heightPercent = widthPercent * (stageRatio / imageRatio);
      const overflowX = Math.max(0, (widthPercent - 100) / 2);
      const overflowY = Math.max(0, (heightPercent - 100) / 2);
      onOffsetChange(clampOffset(latestOffsetRef.current, { x: overflowX, y: overflowY }));
      onZoomChange(next);
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stage.removeEventListener("wheel", onWheel);
    };
  }, [imageRatio, onOffsetChange, onZoomChange]);

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
        pinchRef.current = { startDistance: distance, startZoom: zoom };
      } else {
        const scale = distance / Math.max(pinchRef.current.startDistance, 1);
        onZoomChange(clampZoom(pinchRef.current.startZoom * scale));
      }
      return;
    }

    if (!dragPointerRef.current) return;
    const stageWidth = Math.max(stageRef.current.clientWidth, 1);
    const stageHeight = Math.max(stageRef.current.clientHeight, 1);
    const { overflowX, overflowY } = computeCoverGeometry();

    const limits = {
      x: overflowX,
      y: overflowY,
    };
    const deltaXPercent = ((event.clientX - dragPointerRef.current.x) / stageWidth) * 100;
    const deltaYPercent = ((event.clientY - dragPointerRef.current.y) / stageHeight) * 100;

    dragPointerRef.current = { x: event.clientX, y: event.clientY };
    onOffsetChange(clampOffset({ x: offset.x - deltaXPercent, y: offset.y - deltaYPercent }, limits));
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
        className={`relative w-full overflow-hidden bg-black ${aspect === "portrait" ? "aspect-[3/5]" : "aspect-square"}`}
        style={{
          backgroundImage: `url(${dataUrl})`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: `calc(50% + ${offset.x}%) calc(50% + ${offset.y}%)`,
          backgroundSize: `${computeCoverGeometry().baseWidthPercent * zoom}%`,
        }}
      >
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
