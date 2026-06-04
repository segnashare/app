import { segnaDialogBodyClass } from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

const BULLET_RE = /^[•\-–]\s*/;

/** Intro CMS : 1ʳᵉ ligne = accroche, lignes `•` = puces dans un même bloc. */
export function IncludedCreditsSummaryText({
  introBody,
  className,
}: {
  introBody: string;
  className?: string;
}) {
  const lines = introBody
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const lead = lines.filter((l) => !BULLET_RE.test(l));
  const bullets = lines
    .filter((l) => BULLET_RE.test(l))
    .map((l) => l.replace(BULLET_RE, ""));

  if (lines.length === 0) return null;

  return (
    <div className={cn(segnaDialogBodyClass(), className)}>
      {lead.length > 0 ? (
        <p className="text-zinc-700">{lead.join(" ")}</p>
      ) : null}
      {bullets.length > 0 ? (
        <ul
          className={cn(
            "mt-2 list-disc space-y-1.5 pl-5 text-zinc-600",
            lead.length === 0 && "mt-0",
          )}
        >
          {bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
