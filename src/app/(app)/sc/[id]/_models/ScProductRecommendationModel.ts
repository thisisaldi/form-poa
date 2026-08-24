export interface ScProductRecommendationItem {
  pro_code: string;
  pro_name: string;
  total_sellout?: number;
  average_sellout?: number;
  total_insentif?: number;
  average_insentif?: number;
  active_period_count?: number;
  active_periods?: number[];
  kode_item?: string;
}

export interface ScProductRecommendationApiResponse {
  data: ScProductRecommendationItem[];
}

export interface LossSalesRekomendasiProduct {
  product_code: string;
  product_name: string;
  sales_potential: number;
  is_focus_product?: boolean;
  stock?: number;
  label?: string;
  switch_products?: any[];
}

export interface LossSalesRekomendasiPiGroup {
  pi_code: string;
  pdn?: string;
  products: LossSalesRekomendasiProduct[];
}

export interface LossSalesRekomendasiApiResponse {
  data: LossSalesRekomendasiPiGroup[] | { pi_code?: string; pdn?: string; products: LossSalesRekomendasiProduct[] };
}


