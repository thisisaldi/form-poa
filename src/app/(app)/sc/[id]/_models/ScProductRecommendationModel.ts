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

