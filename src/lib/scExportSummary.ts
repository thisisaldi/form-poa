/**
 * Row inputs of the SC Excel exports for a form with a stored summary
 * (docs/sc-form-summary): sales counter value, HNA and cashback come from the
 * form's own rows, so the export does not ask Canvasser about that outlet at
 * all. Forms without a summary keep going through Canvasser in the routes.
 */

type Decimalish = { toString(): string } | number | null | undefined;

const num = (v: Decimalish) => (v == null ? 0 : parseFloat(v.toString()) || 0);

export function hasScSummary(form: { summaryVersion?: number | null }): boolean {
  return form.summaryVersion != null;
}

/** A row counts as an SC product when the save stored a sales counter value for it. */
export function isStoredScProduct(row: { kodeProduk?: string | null; salesCounterValue?: Decimalish }): boolean {
  return Boolean(row.kodeProduk) && row.salesCounterValue != null;
}

export function storedProductInputs(row: {
  hnaSnapshot?: Decimalish;
  salesCounterValue?: Decimalish;
  salesCounterMinimum?: number | null;
}): { hnaSJ: number; scVal: number; scMin: number } {
  return { hnaSJ: num(row.hnaSnapshot), scVal: num(row.salesCounterValue), scMin: row.salesCounterMinimum || 0 };
}

/**
 * "Cashback / bulan" of one row. A row on a form month holds that month's
 * cashback. A product whose rows fall on no form month (legacy single row)
 * holds its whole cashback on one row, shown as the monthly average like the
 * export did before.
 */
export function storedCashbackBulan(
  row: { periodeMonth?: string | null; cashbackSnapshot?: Decimalish },
  periodMonths: string[],
  lama: number
): number {
  const value = num(row.cashbackSnapshot);
  const onFormMonth = row.periodeMonth ? periodMonths.includes(row.periodeMonth) : false;
  return onFormMonth ? value : value / Math.max(1, lama);
}

export function storedCashbackTotal(rows: { cashbackSnapshot?: Decimalish }[]): number {
  return rows.reduce((sum, r) => sum + num(r.cashbackSnapshot), 0);
}
