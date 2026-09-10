export interface OnlineApotekSalesWidgetProps {
  poaPeriod?: string | null;
  outletCode?: string | null;
  outletName?: string | null;
  isOnline?: boolean;
  className?: string;
}

export interface BlastInTableProps {
  poaPeriod?: string;
  quarter?: number;
  outletId?: string;
  estimasiSales?: number;
}

export interface PosmTableProps {
  poaPeriod?: string;
  quarter?: number;
  outletId?: string;
  onTotalValueChange?: (total: number) => void;
}

export interface PerincianBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalEstimasiBudget?: number;
  totalNilaiSc: number;
  totalDiskonVal: number;
  totalEntertainVal: number;
  totalCashbackVal: number;
  totalBlastInVal?: number;
  totalPosmVal?: number;
  showCashback?: boolean;
  showBlastIn?: boolean;
  showPosm?: boolean;
}

export interface UnitInputProps {
  value: string;
  onChange: (v: string) => void;
  unit?: string | null;
  placeholder?: string;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
}
