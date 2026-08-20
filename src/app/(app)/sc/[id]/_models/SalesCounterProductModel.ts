export interface SalesCounterProduct {
  pro_code: string;
  kode_item: string;
  pro_name: string;
  pro_sell_pack_name: string;
  sell_unit: number;
  pro_med_pack_name: string;
  med_unit: number;
  sales_counter_value: number;
  sales_counter_minimum: number;
  sales_counter_minimum_1: number;
  sales_counter_minimum_2: number;
}

export interface SalesCounterProductApiResponse {
  data: SalesCounterProduct[];
}
