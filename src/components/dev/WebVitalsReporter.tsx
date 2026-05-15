"use client";

import { useReportWebVitals } from "next/web-vitals";

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (process.env.NEXT_PUBLIC_SEGNA_WEB_VITALS !== "1") return;
    console.info("[segna-web-vitals]", metric.name, {
      value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value),
      rating: metric.rating,
      id: metric.id,
    });
  });
  return null;
}
