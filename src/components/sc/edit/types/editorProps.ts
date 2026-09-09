import type { Product } from "@/lib/masterData";
import type { Person } from "./person";
import type { EntertainItem } from "./entertain";
import type { SelectedProductRow } from "./productRow";
import type { SalesCounterProduct } from "@/app/(app)/sc/[id]/_models/SalesCounterProductModel";
import type { CashbackData } from "./cashback";

export interface SalesCounterEditByIdInitialProduct {
  id: string;
  kodeProduk: string;
  namaProduk: string;
  produkKompetitor: string | null;
  qtyPerBulan: number;
  persenMatriksSc: number;
  persenDiskon: number;
  persenCashback: number;
  rencanaTotalBiaya: number;
}

export interface SalesCounterEditByIdEditorProps {
  scId: string;
  poaPeriod: string;
  kodePI: string;
  namaOutlet: string | null;
  is_sc?: boolean;
  isBlastIn?: boolean;
  isPosm?: boolean;
  isOnline?: boolean;
  persons: Person[];
  initialProducts: SalesCounterEditByIdInitialProduct[];
  initialEntertainItems: EntertainItem[];
  initialPeriodeAwal: string;
  initialLamaPeriode: number;
  initialPersenResepDokter: number;
  initialJumlahKaryawan?: number | null;
  initialJumlahPasien?: number | null;
  initialJumlahPasienResep?: number | null;
  initialJumlahPasienNonResep?: number | null;
  masterProducts: Product[];
  readOnly?: boolean;
  isOwner?: boolean;
  status?: string;
}

export interface OutletOptionItem {
  kodePI: string;
  namaOutlet: string;
  groupRS: string | null;
  sector?: string | null;
  subSektor?: string | null;
  is_sc?: boolean;
  jumlah_sc?: number | null;
  isBlastIn?: boolean;
  isPosm?: boolean;
  isOnline?: boolean;
}

export interface SalesCounterLineItemEditorProps {
  poaId: string;
  poaPeriod: string;
  ownerName?: string;
  outlets: OutletOptionItem[];
  products: Product[];
  savedDrafts?: any[];
}

export interface ProductSelectorProps {
  rows: SelectedProductRow[];
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  onUpdateRow: (index: number, fields: Partial<SelectedProductRow>) => void;
  productsOptions: any[];
  canvasserProducts: SalesCounterProduct[];
  masterProducts: Product[];
  lamaPeriode: number;
  periodeAwal?: string;
  diskonPeriode?: string;
  cashbackPeriode?: string;
  cashbackData?: CashbackData | null;
  hideCashback?: boolean;
  isLoading?: boolean;
  error?: string;
  readOnly?: boolean;
  b3SalesMap?: Map<string, number>;
  b3QtyMap?: Map<string, number>;
  b3RangeLabel?: string;
  kodePI?: string;
}
