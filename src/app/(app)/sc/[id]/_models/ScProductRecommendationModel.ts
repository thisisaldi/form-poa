export interface ScProductRecommendationItem {
  kode_item: string;
  pro_name: string;
}

export interface ScProductRecommendationApiResponse {
  data: ScProductRecommendationItem[];
}
