export type OnboardingDemoItem = {
  id: string;
  title: string;
  status: "available" | "reserved" | "lent";
};

export type OnboardingDemoState = {
  items: OnboardingDemoItem[];
  cart: {
    id: string;
    lines: Array<{
      itemId: string;
      qty: number;
    }>;
    status: "draft" | "confirmed";
  };
  orders: Array<{
    id: string;
    state: "confirmed" | "shipped";
    total: number;
  }>;
};

export const CHECKLIST_ITEMS = [
  "check_profile_done",
  "check_list_first_item_done",
  "check_style_size_done",
  "check_first_cart_done",
] as const;

export type OnboardingChecklistItem = (typeof CHECKLIST_ITEMS)[number];

export function getDefaultOnboardingDemoState(): OnboardingDemoState {
  return {
    items: [
      { id: "demo-item-1", title: "Veste laine marine", status: "available" },
      { id: "demo-item-2", title: "Pantalon beige droit", status: "available" },
    ],
    cart: {
      id: "demo-cart-1",
      lines: [{ itemId: "demo-item-1", qty: 1 }],
      status: "draft",
    },
    orders: [{ id: "demo-order-1", state: "confirmed", total: 59 }],
  };
}
