import type { Product } from "@/lib/masterData";
import type { SalesCounterProduct } from "@/app/(app)/sc/[id]/_models/SalesCounterProductModel";

export interface BuildProductOptionsParams {
  canvasserProducts: SalesCounterProduct[];
  princodeProducts: any[];
  productsMenang?: any[];
  productsInsentif?: any[];
  masterProducts: Product[];
  historySalesData?: any;
  surveyData?: any[];
}

export function buildScProductOptions({
  canvasserProducts = [],
  princodeProducts = [],
  productsMenang = [],
  productsInsentif = [],
  masterProducts = [],
  historySalesData,
  surveyData = [],
}: BuildProductOptionsParams) {
  // 1. Build survey map (Nexus survey data)
  const surveyMap = new Map<string, { totalPotensiBulan: number | null; jumlahDokter: number; namaProdukRekomendasi: string }>();
  if (Array.isArray(surveyData)) {
    for (const s of surveyData) {
      const code = String(s.kodeProduk || "").trim();
      if (code) {
        const info = {
          totalPotensiBulan: s.totalPotensiBulan != null ? Number(s.totalPotensiBulan) : null,
          jumlahDokter: s.jumlahDokter || 1,
          namaProdukRekomendasi: s.namaProdukRekomendasi || code,
        };
        surveyMap.set(code, info);
        surveyMap.set(code.replace(/^0+/, ""), info);
      }
    }
  }

  // 2. Build history sales map
  const historySalesMap = new Map<string, number>();
  if (historySalesData) {
    const items = Array.isArray(historySalesData?.data)
      ? historySalesData.data
      : Array.isArray(historySalesData)
      ? historySalesData
      : [];
    for (const it of items) {
      const code = String(it.code || "").trim();
      const qty = Number(it.history_sales) || 0;
      if (code && qty > 0) {
        historySalesMap.set(code, qty);
        historySalesMap.set(code.replace(/^0+/, ""), qty);
      }
    }
  }

  const menangCodes = new Set([
    ...(productsMenang || []).map((p: any) => typeof p === "string" ? p : p.pro_code || p.kode_item || p.kodeProduk || p.code),
    ...(productsInsentif || []).map((p: any) => typeof p === "string" ? p : p.pro_code || p.kode_item || p.kodeProduk || p.code),
  ].filter(Boolean));

  const promilanKeywords = ["PRORIS", "MICROLAX", "POLYSILANE"];

  const groupSurvey: any[] = [];
  const groupPernahOrder: any[] = [];
  const groupPromilan: any[] = [];
  const groupProdukSc: any[] = [];
  const groupLainnya: any[] = [];

  const processedCodes = new Set<string>();

  // Process canvasserProducts
  for (const p of canvasserProducts) {
    const code = String(p.pro_code || "").trim();
    if (!code) continue;
    const strippedCode = code.replace(/^0+/, "");
    processedCodes.add(code);
    processedCodes.add(strippedCode);

    const masterP = masterProducts.find((mp) => mp.kodeProduk === code || mp.kodeProduk.replace(/^0+/, "") === strippedCode);
    const isMenang = menangCodes.has(code) || menangCodes.has(strippedCode);
    const salesQty = historySalesMap.get(code) ?? historySalesMap.get(strippedCode) ?? 0;
    const surveyInfo = surveyMap.get(code) ?? surveyMap.get(strippedCode);
    const nameUpper = String(p.pro_name || masterP?.namaProduk || "").toUpperCase();
    const isPromilan = promilanKeywords.some((kw) => nameUpper.includes(kw));

    const brandStr = masterP?.namaGroupBrand || "Produk SC";
    const zatStr = masterP?.zatAktif ? ` · ${masterP.zatAktif}` : "";

    if (surveyInfo) {
      // Group 1: PRODUK SURVEY (NEXUS)
      groupSurvey.push({
        value: code,
        label: p.pro_name || masterP?.namaProduk || surveyInfo.namaProdukRekomendasi || code,
        sublabel: `${code} · ${brandStr}${zatStr}${surveyInfo.totalPotensiBulan ? ` · Potensi: ${surveyInfo.totalPotensiBulan} UB/bln` : ""}`,
        group: "PRODUK SURVEY (NEXUS)",
        tag: "Produk Survey",
        tagColor: "purple",
        tag2: isMenang ? "Pernah SC" : undefined,
        tag2Color: isMenang ? "green" : undefined,
        _potensi: surveyInfo.totalPotensiBulan || 0,
        _salesQty: salesQty,
      });
    } else if (salesQty > 0) {
      // Group 2: PERNAH ORDER (Sorted descending by salesQty)
      groupPernahOrder.push({
        value: code,
        label: p.pro_name || masterP?.namaProduk || code,
        sublabel: `${code} · ${brandStr}${zatStr} · History: ${salesQty} UB`,
        group: "PERNAH ORDER",
        tag: "Pernah Order",
        tagColor: "blue",
        tag2: isMenang ? "Pernah SC" : undefined,
        tag2Color: isMenang ? "green" : undefined,
        _salesQty: salesQty,
      });
    } else if (isPromilan) {
      // Group 3: PRODUK PROMILAN SC
      groupPromilan.push({
        value: code,
        label: p.pro_name || masterP?.namaProduk || code,
        sublabel: `${code} · ${brandStr}${zatStr}`,
        group: "PRODUK PROMILAN SC",
        tag: "Promilan SC",
        tagColor: "green",
        tag2: isMenang ? "Pernah SC" : undefined,
        tag2Color: isMenang ? "green" : undefined,
        _salesQty: 0,
      });
    } else {
      // Group 4: PRODUK SC
      groupProdukSc.push({
        value: code,
        label: p.pro_name || masterP?.namaProduk || code,
        sublabel: `${code} · ${brandStr}${zatStr}`,
        group: "PRODUK SC",
        tag: "Produk SC",
        tagColor: "orange",
        tag2: isMenang ? "Pernah SC" : undefined,
        tag2Color: isMenang ? "green" : undefined,
        _salesQty: 0,
      });
    }
  }

  // Process any survey products not in canvasserProducts
  if (Array.isArray(surveyData)) {
    for (const s of surveyData) {
      const code = String(s.kodeProduk || "").trim();
      if (!code) continue;
      const strippedCode = code.replace(/^0+/, "");
      if (processedCodes.has(code) || processedCodes.has(strippedCode)) continue;

      processedCodes.add(code);
      processedCodes.add(strippedCode);
      const masterP = masterProducts.find((mp) => mp.kodeProduk === code || mp.kodeProduk.replace(/^0+/, "") === strippedCode);
      const isMenang = menangCodes.has(code) || menangCodes.has(strippedCode);
      const salesQty = historySalesMap.get(code) ?? historySalesMap.get(strippedCode) ?? 0;
      const potensiNum = s.totalPotensiBulan != null ? Number(s.totalPotensiBulan) : 0;

      groupSurvey.push({
        value: code,
        label: s.namaProdukRekomendasi || masterP?.namaProduk || code,
        sublabel: `${code} · ${masterP?.namaGroupBrand || "Data Survey"}${potensiNum > 0 ? ` · Potensi: ${potensiNum} UB/bln` : ""}`,
        group: "PRODUK SURVEY (NEXUS)",
        tag: "Produk Survey",
        tagColor: "purple",
        tag2: isMenang ? "Pernah SC" : undefined,
        tag2Color: isMenang ? "green" : undefined,
        _potensi: potensiNum,
        _salesQty: salesQty,
      });
    }
  }

  // Process princode products
  for (const p of princodeProducts) {
    const code = String(p.code || "").trim();
    if (!code) continue;
    const strippedCode = code.replace(/^0+/, "");
    if (processedCodes.has(code) || processedCodes.has(strippedCode)) continue;

    processedCodes.add(code);
    processedCodes.add(strippedCode);
    const masterP = masterProducts.find((mp) => mp.kodeProduk === code || mp.kodeProduk.replace(/^0+/, "") === strippedCode);
    const isMenang = menangCodes.has(code) || menangCodes.has(strippedCode);
    const salesQty = historySalesMap.get(code) ?? historySalesMap.get(strippedCode) ?? 0;

    if (salesQty > 0) {
      groupPernahOrder.push({
        value: code,
        label: p.name || masterP?.namaProduk || code,
        sublabel: `${code} · ${masterP?.namaGroupBrand || "Master Produk"} · History: ${salesQty} UB`,
        group: "PERNAH ORDER",
        tag: "Pernah Order",
        tagColor: "blue",
        tag2: isMenang ? "Pernah SC" : undefined,
        tag2Color: isMenang ? "green" : undefined,
        _salesQty: salesQty,
      });
    } else {
      groupLainnya.push({
        value: code,
        label: p.name || masterP?.namaProduk || code,
        sublabel: `${code} · ${masterP?.namaGroupBrand || "Master Produk"}${masterP?.zatAktif ? ` · ${masterP.zatAktif}` : ""}`,
        group: isMenang ? "PERNAH SC" : "PRODUK LAINNYA",
        tag2: isMenang ? "Pernah SC" : undefined,
        tag2Color: isMenang ? "green" : undefined,
        _salesQty: 0,
      });
    }
  }

  // Sort PERNAH ORDER descending by salesQty ("pastikan order dari label terbanyak")
  groupPernahOrder.sort((a, b) => b._salesQty - a._salesQty);

  // Sort SURVEY descending by potensi
  groupSurvey.sort((a, b) => (b._potensi || 0) - (a._potensi || 0));

  return [
    ...groupSurvey,
    ...groupPernahOrder,
    ...groupPromilan,
    ...groupProdukSc,
    ...groupLainnya,
  ];
}
