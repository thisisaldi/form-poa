export type SidebarTab = "rekomendasi" | "loss_sales" | "history" | "analisis_kompetitor";

export interface ScSidebarProps {
  poaPeriod?: string | null;
  doctorName?: string;
  productsMenang?: any[];
  productsInsentif?: any[];
  insentifHistory?: any;
  historySalesData?: any;
  salesOnlineData?: any;
  surveyData?: any[];
  surveyNexusData?: any;
  rekomendasiProduk?: any[];
  masterProducts?: any[];
  canvasserProducts?: any[];
  healthyOneData?: any[];
  selectedProductCodes?: Set<string>;
  onSelectProduct?: (code: string) => void;
}
