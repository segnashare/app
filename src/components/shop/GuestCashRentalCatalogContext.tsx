"use client";

import { createContext, useContext } from "react";

const GuestCashRentalCatalogContext = createContext(false);

export function GuestCashRentalCatalogProvider({
  guestCashRental,
  children,
}: {
  guestCashRental: boolean;
  children: React.ReactNode;
}) {
  return (
    <GuestCashRentalCatalogContext.Provider value={guestCashRental}>
      {children}
    </GuestCashRentalCatalogContext.Provider>
  );
}

export function useGuestCashRentalCatalog(): boolean {
  return useContext(GuestCashRentalCatalogContext);
}
