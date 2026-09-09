export const REJECT_CATEGORY_LABELS: Record<string, string> = {
  PRODUK: "Produk",
  OUTLET: "Outlet",
  USER: "User / SC",
  PERIODE: "Periode",
  KALKULASI_PSSP: "Kalkulasi Sales Counter",
  ALASAN_LAIN: "Alasan Lain",
};

export type RejectCategoryKey = keyof typeof REJECT_CATEGORY_LABELS;

export const REJECT_CATEGORY_OPTIONS = Object.entries(REJECT_CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}));
