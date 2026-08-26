type Listener = () => void;

const listeners = new Set<Listener>();

/** Demande un rechargement de la bottom sheet « litige pièce clôturé » (web). */
export function requestItemDisputeAlertRefresh() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeItemDisputeAlertRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
