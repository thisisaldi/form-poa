export interface EntertainRow {
  month: string;      // YYYYMM
  label: string;      // e.g. "Juli 2026"
  value: string;      // input value in Rp
}

export interface EntertainItem {
  id: string;
  periodeMonth: string;
  biayaEntertain: number;
}
