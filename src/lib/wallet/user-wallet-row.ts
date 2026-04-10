/** Ligne `user_wallets` (points) après migration double solde. */
export type UserWalletPointsRow = {
  balance_points: number | null;
  balance_consumption_points: number | null;
  balance_exchange_points: number | null;
};

export function parseUserWalletPointsRow(row: Partial<UserWalletPointsRow> | null | undefined): {
  consumption: number;
  exchange: number;
  total: number;
} {
  const consumption = Math.max(0, Math.floor(Number(row?.balance_consumption_points ?? 0)));
  const exchange = Math.max(0, Math.floor(Number(row?.balance_exchange_points ?? 0)));
  const sum = consumption + exchange;
  const fromLegacyTotal = Math.max(0, Math.floor(Number(row?.balance_points ?? 0)));
  /** Si les colonnes split existent mais sont à 0 alors qu’un total legacy est présent (migration partielle). */
  const total = sum > 0 || fromLegacyTotal === 0 ? sum : fromLegacyTotal;
  return { consumption, exchange, total };
}
