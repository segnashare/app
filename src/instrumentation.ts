/**
 * Point d’entrée instrumentation Next (build / runtime serveur).
 * Utile pour brancher APM ou logs de boot ; la mesure navigateur passe par WebVitalsReporter.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SEGNA_PERF_DEBUG === "1") {
    console.info("[segna] instrumentation: SEGNA_PERF_DEBUG actif (Server-Timing + logs [segna-perf])");
  }
}
