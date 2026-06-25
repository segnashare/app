import { formatBorrowReturnDueDateFr } from "@/lib/cart/cart-borrow-return-due";
import {
  BORROW_FORMAL_NOTICE_DEADLINE_DAYS,
  borrowFormalNoticeDeadlineIso,
} from "@/lib/emprunt/borrow-overdue-recovery-policy";

export const BORROW_FORMAL_NOTICE_TEMPLATE_VERSION = "v1";

export type BorrowFormalNoticeContentInput = {
  firstName: string | null;
  lastName: string | null;
  orderRef: string;
  borrowReturnDueMs: number;
  lateDayIndex: number;
  penaltiesAccruedCents: number;
  cartValueCents: number;
  sentAtIso: string;
};

function formatEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    Math.max(0, cents) / 100,
  );
}

function displayName(firstName: string | null, lastName: string | null): string {
  const parts = [firstName?.trim(), lastName?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Membre Segna";
}

export function buildBorrowFormalNoticeHtml(input: BorrowFormalNoticeContentInput): string {
  const deadlineIso = borrowFormalNoticeDeadlineIso(input.sentAtIso);
  const deadlineLabel = formatBorrowReturnDueDateFr(new Date(deadlineIso).getTime());
  const dueLabel = formatBorrowReturnDueDateFr(input.borrowReturnDueMs);
  const name = displayName(input.firstName, input.lastName);

  return `<p>Bonjour ${name},</p>
<p><strong>Mise en demeure de restituer votre emprunt Segna</strong></p>
<p>Malgré nos relances, l'emprunt <strong>${input.orderRef}</strong> n'a pas été restitué à la date prévue du <strong>${dueLabel}</strong> (retard : ${input.lateDayIndex} jour${input.lateDayIndex > 1 ? "s" : ""}).</p>
<p>Par la présente, nous vous <strong>mettons en demeure</strong> de déposer votre colis au point relais ou de nous contacter sous <strong>${BORROW_FORMAL_NOTICE_DEADLINE_DAYS} jours calendaires</strong>, soit au plus tard le <strong>${deadlineLabel}</strong>.</p>
<p>À ce jour, les frais de retard cumulés s'élèvent à <strong>${formatEuros(input.penaltiesAccruedCents)}</strong>. La valeur de votre panier est estimée à <strong>${formatEuros(input.cartValueCents)}</strong>.</p>
<p>À défaut de restitution dans ce délai, nous pourrons engager les démarches prévues par nos conditions générales de location, y compris l'exigibilité de la valeur du panier et des frais afférents.</p>
<p>Segna — Service membre</p>`;
}

export function buildBorrowFormalNoticeText(input: BorrowFormalNoticeContentInput): string {
  return buildBorrowFormalNoticeHtml(input)
    .replace(/<\/p>/g, "\n\n")
    .replace(/<p>/g, "")
    .replace(/<strong>/g, "")
    .replace(/<\/strong>/g, "")
    .trim();
}
