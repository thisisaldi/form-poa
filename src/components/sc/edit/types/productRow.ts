export interface SelectedProductRow {
  kodeProduk: string;
  produkKompetitor: string;
  qtyPerBulan: string;
  monthlyQty?: string[];
  persenMatriksSc: string;
  persenDiskon: string;
  persenCashback: string;
  rencanaTotalBiaya: number; // monthly estimate * duration
}

export type ProductRow = SelectedProductRow;
