"use client";

type ClientPerfExtra = Record<string, unknown>;

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function isClientPhotoPerfEnabled() {
  if (typeof window === "undefined") return false;
  return (
    process.env.NEXT_PUBLIC_SEGNA_PERF_DEBUG === "1" ||
    process.env.NODE_ENV === "development" ||
    window.localStorage.getItem("segna:perf") === "1"
  );
}

export function logClientPhotoPerf(name: string, ms: number, extra?: ClientPerfExtra) {
  if (!isClientPhotoPerfEnabled()) return;
  console.info("[segna-photo-perf]", {
    name,
    ms: Math.round(ms),
    ...extra,
  });
}

export async function measureClientPhotoPerf<T>(name: string, fn: () => Promise<T> | T, extra?: ClientPerfExtra): Promise<T> {
  if (!isClientPhotoPerfEnabled()) return fn();
  const startedAt = nowMs();
  try {
    return await fn();
  } finally {
    logClientPhotoPerf(name, nowMs() - startedAt, extra);
  }
}
