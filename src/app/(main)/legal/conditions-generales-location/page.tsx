import { redirect } from "next/navigation";

import { BORROW_OVERDUE_CG_LOCATION_HREF } from "@/lib/cart/format-borrow-overdue-copy";

export default function ConditionsGeneralesLocationPage() {
  redirect(BORROW_OVERDUE_CG_LOCATION_HREF);
}
