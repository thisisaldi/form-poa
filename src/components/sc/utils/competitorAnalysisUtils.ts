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

export const DUMMY_KOMPETITOR_DATA: DummyKompetitorItem[] = [
  {
    kodeProduk: "0201478",
    namaProduk: "PRORIS SUSP 60 ML RASA JERUK",
    subtitel: "0201478 · PRORIS · Ibuprofen 100mg/5ml",
    zatAktif: "IBUPROFEN",
    internalSales: {
      healthyOneUb: 10,
      b2bSellInUb: 16.67,
    },
    surveyCompetitor: {
      namaKompetitor: "Sanmol Syrup 60ml",
      forecastPenjualanKompetitor: "5 UB",
      potensiProrisUb: 35,
    },
  },
  {
    kodeProduk: "0201784",
    namaProduk: "POLYSILANE SUSPENSI 100 ML",
    subtitel: "0201784 · POLYSILANE · Antasida Doen & Dimethicone",
    zatAktif: "AL(OH)3, MG(OH)2, DIMETHICONE",
    internalSales: {
      healthyOneUb: 18,
      b2bSellInUb: 7.33,
    },
    surveyCompetitor: {
      namaKompetitor: "Mylanta Liquid 150ml",
      forecastPenjualanKompetitor: "8 UB",
      potensiProrisUb: 51,
    },
  },
  {
    kodeProduk: "0202144",
    namaProduk: "MICROLAX 3 X 5 ML",
    subtitel: "0202144 · MICROLAX · Na Lauril Sulfoasetat",
    zatAktif: "NA LAURYL SULFATE, PEG, SORBITOL, NA CITRATE, SORBIC ACID",
    internalSales: {
      healthyOneUb: 8,
      b2bSellInUb: 3.33,
    },
    surveyCompetitor: {
      namaKompetitor: "Dulcolax Suppositoria",
      forecastPenjualanKompetitor: "4 UB",
      potensiProrisUb: 27,
    },
  },
];

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

export interface ProductPotensiDetail {
  kodeProduk: string;
  namaProduk: string;
  zatAktif: string;
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
  salesOnlineItems: any[] = []
): ProductPotensiDetail {
  const code = String(product.kodeProduk || product.pro_code || product.kode_item || "").trim();
  const strippedCode = code.replace(/^0+/, "");
  const name = String(
    product.namaProduk ||
    product.pro_name ||
    product.name ||
    code ||
    "Produk"
  ).trim();
  const upperName = name.toUpperCase();

  // 1. Resolve Dummy Config or Defaults based on product code / brand
  const dummyMap = new Map<string, DummyKompetitorItem>();
  for (const d of DUMMY_KOMPETITOR_DATA) {
    const c = d.kodeProduk.trim();
    dummyMap.set(c, d);
    dummyMap.set(c.replace(/^0+/, ""), d);
  }

  const dummyRef = dummyMap.get(code) || dummyMap.get(strippedCode);

  let zatAktif = (product.zatAktif || product.zat_aktif || dummyRef?.zatAktif || "").trim().toUpperCase();
  let defaultKompetitorName = `Kompetitor ${name.split(" ")[0] || "Umum"}`;
  let defaultSurveyQty = 5;
  let defaultHealthyOneUb = 10;

  if (upperName.includes("PRORIS")) {
    if (!zatAktif) zatAktif = "IBUPROFEN";
    defaultKompetitorName = "Sanmol Syrup 60ml";
    defaultSurveyQty = 5;
    defaultHealthyOneUb = 10;
  } else if (upperName.includes("POLYSILANE")) {
    if (!zatAktif) zatAktif = "AL(OH)3, MG(OH)2, DIMETHICONE";
    defaultKompetitorName = "Mylanta Liquid 150ml";
    defaultSurveyQty = 8;
    defaultHealthyOneUb = 18;
  } else if (upperName.includes("MICROLAX")) {
    if (!zatAktif) zatAktif = "NA LAURYL SULFATE, PEG, SORBITOL, NA CITRATE, SORBIC ACID";
    defaultKompetitorName = "Dulcolax Suppositoria";
    defaultSurveyQty = 4;
    defaultHealthyOneUb = 8;
  } else if (upperName.includes("ARCOLASE")) {
    if (!zatAktif) zatAktif = "ESOMEPRAZOLE";
    defaultKompetitorName = "Nexium 20mg";
    defaultSurveyQty = 5;
    defaultHealthyOneUb = 10;
  } else if (upperName.includes("SALBUVEN")) {
    if (!zatAktif) zatAktif = "SALBUTAMOL";
    defaultKompetitorName = "Ventolin 2mg";
    defaultSurveyQty = 4;
    defaultHealthyOneUb = 6;
  } else if (upperName.includes("VASTROL") || upperName.includes("STAVINOR")) {
    if (!zatAktif) zatAktif = "ATORVASTATIN";
    defaultKompetitorName = "Lipitor 20mg";
    defaultSurveyQty = 6;
    defaultHealthyOneUb = 12;
  } else if (upperName.includes("BECANTEX")) {
    if (!zatAktif) zatAktif = "REBAMIPIDE";
    defaultKompetitorName = "Mucosta 100mg";
    defaultSurveyQty = 5;
    defaultHealthyOneUb = 8;
  } else if (upperName.includes("ROZGRA")) {
    if (!zatAktif) zatAktif = "SILDENAFIL";
    defaultKompetitorName = "Viagra 50mg";
    defaultSurveyQty = 3;
    defaultHealthyOneUb = 5;
  }

  const surveyName = dummyRef?.surveyCompetitor?.namaKompetitor || defaultKompetitorName;
  const rawSurveyForecast = String(dummyRef?.surveyCompetitor?.forecastPenjualanKompetitor || defaultSurveyQty);
  const surveyQty = parseFloat(rawSurveyForecast.replace(/[^0-9.]/g, "")) || defaultSurveyQty;
  const healthyOneUb = dummyRef?.internalSales?.healthyOneUb ?? defaultHealthyOneUb;

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
    surveyQty,
    surveyName,
    healthyOneUb,
    b2bQty,
    b2bProducts: matchingB2bItems,
    totalPotensi,
  };
}
