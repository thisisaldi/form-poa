export interface DummyKompetitorItem {
  kodeProduk: string;
  namaProduk: string;
  subtitel: string;
  zatAktif: string;
  internalSales: {
    healthyOneUb: number;
    b2bSellInUb: number;
  };
  surveyCompetitor: {
    namaKompetitor: string;
    forecastPenjualanKompetitor: string;
    potensiProrisUb: number;
  };
}

export const DUMMY_KOMPETITOR_DATA: DummyKompetitorItem[] = [];

export const FALLBACK_PRODUCT_NAMES: Record<string, string> = {
  "0110492": "PRORIS FORTE 200MG SUSP 50ML",
  "0201478": "PRORIS SUSP 60 ML RASA JERUK",
  "0202672": "PRORIS IBUPROFEN 10 KAPLET",
  "0201784": "POLYSILANE SUSPENSI 100 ML",
  "0200850": "POLYSILANE SUSPENSI 180 ML",
  "0200851": "POLYSILANE MAX TABLET",
  "0202144": "MICROLAX 3 X 5 ML",
  "0203638": "MICROLAXTAB BISACODYL 5MG",
  "0302259": "NOURISH SKIN 30 TABLET",
  "0110168": "GLICOLON 5MG TAB 100`S",
  "0110515": "ARCOLASE 20MG TAB 30`S",
};

export function formatQtySales(qty: number): string {
  if (qty == null || isNaN(qty)) return "0";
  const rounded = Math.round(qty * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function isSameZatAktif(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const cleanA = a.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
  const cleanB = b.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;

  const wordsA = a.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 3);
  const wordsB = b.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 3);
  return wordsA.some((wa) => wordsB.includes(wa));
}

/**
 * Build lookup map from Nexus survey response: procode -> list of competitors
 */
export function buildNexusSurveyMap(surveyNexusData: any) {
  const map = new Map<string, Array<{ namaKompetitor: string; salesForecast: number }>>();
  if (!surveyNexusData?.data?.has_data) return map;

  const surveys = surveyNexusData.data.surveys;
  if (!Array.isArray(surveys) || surveys.length === 0) return map;

  // Use latest survey (index 0)
  const latestSurvey = surveys[0];
  const products = Array.isArray(latestSurvey?.products) ? latestSurvey.products : [];

  for (const p of products) {
    const compName = String(p.product_name || "").trim();
    const forecast = Number(p.sales_forecast) || 0;
    const switching = Array.isArray(p.switching_products) ? p.switching_products : [];

    for (const sw of switching) {
      const procode = String(sw.procode || "").trim();
      if (!procode) continue;
      const stripped = procode.replace(/^0+/, "");
      const entry = { namaKompetitor: compName, salesForecast: forecast };

      const addKey = (k: string) => {
        const list = map.get(k) ?? [];
        if (!list.some((it) => it.namaKompetitor === compName)) {
          list.push(entry);
        }
        map.set(k, list);
      };

      addKey(procode);
      if (stripped) addKey(stripped);
    }
  }
  return map;
}

export interface ProductPotensiDetail {
  kodeProduk: string;
  namaProduk: string;
  zatAktif: string;
  surveyCompetitors: Array<{ namaKompetitor: string; salesForecast: number }>;
  surveyQty: number;
  surveyName: string;
  healthyOneUb: number;
  b2bQty: number;
  b2bProducts: Array<{ code: string; namaProduk: string; qty_sales: number }>;
  totalPotensi: number;
}

export function getProductPotensiDetail(
  product: {
    kodeProduk?: string;
    pro_code?: string;
    kode_item?: string;
    namaProduk?: string;
    pro_name?: string;
    name?: string;
    zatAktif?: string;
    zat_aktif?: string;
  },
  salesOnlineItems: any[] = [],
  nexusSurveyMap?: Map<string, Array<{ namaKompetitor: string; salesForecast: number }>>
): ProductPotensiDetail {
  const code = String(product.kodeProduk || product.pro_code || product.kode_item || "").trim();
  const strippedCode = code.replace(/^0+/, "");
  const name = String(
    product.namaProduk ||
    product.pro_name ||
    product.name ||
    FALLBACK_PRODUCT_NAMES[code] ||
    FALLBACK_PRODUCT_NAMES[strippedCode] ||
    code ||
    "Produk"
  ).trim();

  // Look up zatAktif from product directly or from salesOnlineItems
  let zatAktif = (product.zatAktif || product.zat_aktif || "").trim().toUpperCase();
  if (!zatAktif && Array.isArray(salesOnlineItems)) {
    const matchedOnline = salesOnlineItems.find((it) => {
      const itCode = String(it.code || "").trim();
      return itCode === code || (strippedCode && itCode.replace(/^0+/, "") === strippedCode);
    });
    if (matchedOnline?.zat_aktif) {
      zatAktif = String(matchedOnline.zat_aktif).trim().toUpperCase();
    }
  }

  // 1. Resolve Survey from real Nexus survey map (No dummy fallback)
  const matchedCompetitors = nexusSurveyMap
    ? (nexusSurveyMap.get(code) || (strippedCode ? nexusSurveyMap.get(strippedCode) : undefined) || [])
    : [];

  const surveyCompetitors = matchedCompetitors;
  const surveyQty = matchedCompetitors.reduce((sum, c) => sum + c.salesForecast, 0);
  const surveyName = matchedCompetitors.map((c) => c.namaKompetitor).join(", ");

  // HealthyOne: 0 because no API data currently exists (no dummy 10 UB)
  const healthyOneUb = 0;

  // 2. Logic-wise matching for Sell In (B2B)
  const matchingB2bItems: Array<{ code: string; namaProduk: string; qty_sales: number }> = [];
  if (Array.isArray(salesOnlineItems) && salesOnlineItems.length > 0) {
    for (const it of salesOnlineItems) {
      const itCode = String(it.code || "").trim();
      const itStripped = itCode.replace(/^0+/, "");
      const itQty = Number(it.qty_sales) || 0;
      if (itQty <= 0) continue;

      const isDirectMatch = itCode === code || itStripped === strippedCode;
      const isZatMatch = zatAktif && it.zat_aktif && isSameZatAktif(zatAktif, String(it.zat_aktif));

      if (isDirectMatch || isZatMatch) {
        const resolvedName =
          it.namaProduk ||
          it.pro_name ||
          it.name ||
          FALLBACK_PRODUCT_NAMES[itCode] ||
          FALLBACK_PRODUCT_NAMES[itStripped] ||
          (itCode ? `Produk ${itCode}` : "Produk B2B");

        matchingB2bItems.push({
          code: itCode,
          namaProduk: resolvedName,
          qty_sales: Math.round(itQty * 10) / 10,
        });
      }
    }
  }

  const b2bQty = Math.round(matchingB2bItems.reduce((sum, item) => sum + item.qty_sales, 0) * 10) / 10;
  const totalPotensi = Math.ceil(surveyQty + healthyOneUb + b2bQty);

  return {
    kodeProduk: code,
    namaProduk: name,
    zatAktif,
    surveyCompetitors,
    surveyQty,
    surveyName,
    healthyOneUb,
    b2bQty,
    b2bProducts: matchingB2bItems,
    totalPotensi,
  };
}
