import type { ReactNode } from "react";

/**
 * Segments entourés par `**` → <strong className="font-bold"> (corps du CTA en semi-gras sur le parent).
 * Paire `**` manquante : le reste du texte est affiché tel quel.
 */
export function renderCmsStarBoldSegments(text: string, keyPrefix: string): ReactNode {
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const open = text.indexOf("**", i);
    if (open === -1) {
      if (i < text.length) out.push(text.slice(i));
      break;
    }
    if (open > i) out.push(text.slice(i, open));
    const close = text.indexOf("**", open + 2);
    if (close === -1) {
      out.push(text.slice(open));
      break;
    }
    const inner = text.slice(open + 2, close);
    out.push(
      <strong key={`${keyPrefix}-s${k++}`} className="font-bold">
        {inner}
      </strong>,
    );
    i = close + 2;
  }
  if (out.length === 0) return text;
  if (out.length === 1 && typeof out[0] === "string") return out[0];
  return <>{out}</>;
}
