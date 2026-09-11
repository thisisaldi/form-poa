import type { Product } from "@/lib/masterData";
import type { SalesCounterProduct } from "@/app/(app)/sc/[id]/_models/SalesCounterProductModel";

export interface BuildProductOptionsParams {
  canvasserProducts: SalesCounterProduct[];
  productsMenang?: any[];
  productsInsentif?: any[];
  masterProducts: Product[];
  historySalesData?: any;
  surveyData?: any[];
}

export interface ScProductOptionItem {
  value: string;
  label: string;
  sublabel: string;
  group: string;
  tag: string;
  tagColor: string;
  tag2?: string;
  tag2Color?: string;
  _potensi?: number;
  _salesQty?: number;
}
