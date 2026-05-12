type PerfEntry = {
  name: string;
  ms: number;
};

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function sanitizeServerTimingName(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "segna";
}

export function isPerfDebugEnabled() {
  return process.env.SEGNA_PERF_DEBUG === "1";
}

export function createPerfTracker(scope: string) {
  const enabled = isPerfDebugEnabled();
  const startedAt = nowMs();
  const entries: PerfEntry[] = [];

  const measure = async <T>(name: string, fn: () => PromiseLike<T> | T): Promise<T> => {
    if (!enabled) return fn();
    const t0 = nowMs();
    try {
      return await fn();
    } finally {
      entries.push({ name, ms: nowMs() - t0 });
    }
  };

  const log = (extra?: Record<string, unknown>) => {
    if (!enabled) return;
    const totalMs = nowMs() - startedAt;
    console.info("[segna-perf]", {
      scope,
      totalMs: Math.round(totalMs),
      timings: entries.map((entry) => ({
        name: entry.name,
        ms: Math.round(entry.ms),
      })),
      ...extra,
    });
  };

  const serverTimingHeader = () => {
    if (!enabled) return null;
    return entries
      .map((entry) => `${sanitizeServerTimingName(entry.name)};dur=${entry.ms.toFixed(1)}`)
      .join(", ");
  };

  return {
    enabled,
    measure,
    log,
    serverTimingHeader,
  };
}
