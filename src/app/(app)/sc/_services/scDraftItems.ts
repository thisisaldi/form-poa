import { prisma } from "@/lib/prisma";
import { mapWithConcurrency } from "@/lib/mapWithConcurrency";
import { parseScHistorySales, scHistoryCodeSet, scProCodes } from "@/lib/scFormSummary";
import type { ScDraftFormItem } from "@/components/sc/types";
import { getSalesCounterProduct } from "../[id]/_services/getSalesCounterProduct";
import { postHistorySales } from "../[id]/_services/postHistorySales";

/**
 * Turns PoaScForm rows into the ScDraftFormItem the outlet card and the stats
 * panel read. A form with a stored summary (docs/sc-form-summary) is built
 * from its own columns only — sales counter value, HNA, history B-3 and
 * cashback as frozen at save. A form without one (not backfilled yet, or
 * Canvasser was down when it was saved) falls back to Canvasser, which is what
 * every form did before the summary existed.
 */

/** Relations toScDraftItem needs. Audit logs are only for the card's revision / edit-request info. */
export const SC_DRAFT_FORM_INCLUDE = {
  owner: { select: { nip: true, name: true } },
  products: true,
  persons: true,
  entertainItems: true,
  auditLogs: {
    include: { actor: { select: { nip: true, name: true, role: true, jabatan: true } } },
    orderBy: { createdAt: "asc" as const },
  },
};

export interface ScMasterProduct {
  kodeProduk: string;
  namaProduk: string;
  hna: { toString(): string };
  konversiPembagi: { toString(): string } | null;
  satuanTerkecil: string | null;
  satuan: string | null;
}

export async function loadScMasterProducts(productCodes: string[]): Promise<Map<string, ScMasterProduct>> {
  const codes = Array.from(new Set(productCodes.filter(Boolean)));
  if (codes.length === 0) return new Map();
  const rows: ScMasterProduct[] = await prisma.product.findMany({
    where: { kodeProduk: { in: codes } },
    select: { kodeProduk: true, namaProduk: true, hna: true, konversiPembagi: true, satuanTerkecil: true, satuan: true },
  });
  return new Map(rows.map((p) => [p.kodeProduk, p]));
}

/** What Canvasser says about one outlet, for forms without a stored summary. */
export interface ScLiveOutletData {
  /** pro_code and kode_item of the outlet's SC products, with and without leading zeros. */
  scCodes: Set<string>;
  totalScProducts: number;
  valueByProCode: Map<string, { value: number; minimum: number }>;
  /** Σ sales B-3 (3 months) over the outlet's SC products. */
  historySalesQuarter: number;
}

/**
 * Canvasser's SC product list per outlet plus one batched history call.
 * Only called for outlets that have a form without a summary.
 */
export async function loadScLiveOutletData(
  kodePIs: string[],
  period: string,
  historyPeriods: number[]
): Promise<Map<string, ScLiveOutletData>> {
  const outlets = Array.from(new Set(kodePIs.filter(Boolean)));
  const result = new Map<string, ScLiveOutletData>();
  if (outlets.length === 0) return result;

  const history = await postHistorySales({ piCodes: outlets, period: historyPeriods, agg: true }).catch(() => null);

  await mapWithConcurrency(outlets, 8, async (kodePI) => {
    const res = await getSalesCounterProduct(kodePI, period).catch(() => null);
    const products = res?.data && Array.isArray(res.data) ? res.data : [];
    if (products.length === 0) return;

    const scCodes = new Set<string>();
    const valueByProCode = new Map<string, { value: number; minimum: number }>();
    for (const cp of products) {
      valueByProCode.set(cp.pro_code, { value: cp.sales_counter_value || 0, minimum: cp.sales_counter_minimum || 0 });
      for (const code of [cp.pro_code, cp.kode_item]) {
        if (!code) continue;
        scCodes.add(code);
        scCodes.add(String(code).replace(/^0+/, "").toUpperCase());
      }
    }
    result.set(kodePI, {
      scCodes,
      totalScProducts: products.length,
      valueByProCode,
      historySalesQuarter: parseScHistorySales(history, kodePI, scHistoryCodeSet(scProCodes(products))).total,
    });
  });
  return result;
}

const num = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));

export interface ScDraftItemContext {
  master: Map<string, ScMasterProduct>;
  /** Row of getSalesCounterOutletsDirect for this outlet, when the viewer's outlet list has it. */
  outlet?: {
    is_sc?: unknown;
    jumlah_karyawan?: number | null;
    jumlah_pasien?: number | null;
    jumlah_pasien_resep?: number | null;
    jumlah_pasien_non_resep?: number | null;
  };
  isBlastIn: boolean;
  /** Required for a form without a summary; ignored otherwise. */
  live?: ScLiveOutletData;
}

export function toScDraftItem(d: any, { master, outlet, isBlastIn, live }: ScDraftItemContext): ScDraftFormItem {
  const hasSummary = d.summaryVersion != null;

  let scRows: any[];
  if (hasSummary) {
    scRows = d.products.filter((p: { salesCounterValue: unknown }) => p.salesCounterValue != null);
  } else {
    const scCodes = live?.scCodes;
    scRows =
      scCodes && scCodes.size > 0
        ? d.products.filter(
            (p: { kodeProduk: string }) =>
              scCodes.has(p.kodeProduk) || scCodes.has(String(p.kodeProduk || "").replace(/^0+/, ""))
          )
        : d.products;
  }

  const orOutlet = (own: number | null, fromOutlet: number | null | undefined) =>
    own && own > 0 ? own : (fromOutlet ?? own ?? null);

  return {
    id: d.id,
    period: d.period,
    periodeAwal: d.periodeAwal,
    lamaPeriode: d.lamaPeriode,
    status: d.status,
    version: d.version,
    kodePI: d.kodePI,
    namaOutlet: d.namaOutlet || `Outlet ${d.kodePI}`,
    jumlahKaryawan: orOutlet(d.jumlahKaryawan, outlet?.jumlah_karyawan),
    jumlahPasien: orOutlet(d.jumlahPasien, outlet?.jumlah_pasien),
    jumlahPasienResep: orOutlet(d.jumlahPasienResep, outlet?.jumlah_pasien_resep),
    jumlahPasienNonResep: orOutlet(d.jumlahPasienNonResep, outlet?.jumlah_pasien_non_resep),
    ownerId: d.ownerId,
    ownerName: d.owner?.name,
    ownerNip: d.owner?.nip,
    is_sc: !!outlet?.is_sc,
    isBlastIn,
    hasSummary,
    historyPeriodEnd: hasSummary ? d.historyPeriodEnd : null,
    totalScProducts: hasSummary ? (d.totalScProducts ?? 0) : (live?.totalScProducts ?? 0),
    validScProductsCount: new Set(scRows.map((p: { kodeProduk: string }) => p.kodeProduk).filter(Boolean)).size,
    historySalesQuarter: hasSummary ? num(d.historySalesQuarter) : (live?.historySalesQuarter ?? 0),
    persons: d.persons.map((p: any) => ({
      id: p.id,
      outletPersonId: p.outletPersonId,
      nik_ktp: p.outletPersonId,
      personName: p.personName,
      positionName: p.positionName,
    })),
    products: scRows.map((p: any) => {
      const mp = master.get(p.kodeProduk);
      const cp = live?.valueByProCode.get(p.kodeProduk);
      return {
        id: p.id,
        kodeProduk: p.kodeProduk,
        namaProduk: p.namaProduk,
        periodeMonth: p.periodeMonth,
        produkKompetitor: p.produkKompetitor || null,
        qtyPerBulan: p.qtyPerBulan,
        persenMatriksSc: num(p.persenMatriksSc),
        persenDiskon: num(p.persenDiskon),
        persenCashback: num(p.persenCashback),
        rencanaTotalBiaya: num(p.rencanaTotalBiaya),
        hnaSJ: hasSummary && p.hnaSnapshot != null ? num(p.hnaSnapshot) : num(mp?.hna),
        konversiPembagi: mp?.konversiPembagi ? num(mp.konversiPembagi) : 1,
        satuanTerkecil: mp?.satuanTerkecil || "ST",
        satuanSJ: mp?.satuan || "SJ",
        salesCounterValue: hasSummary ? num(p.salesCounterValue) : (cp?.value ?? 0),
        salesCounterMinimum: hasSummary ? (p.salesCounterMinimum ?? 0) : (cp?.minimum ?? 0),
        isScProduct: hasSummary ? true : (live?.scCodes.has(p.kodeProduk) ?? false),
        historySalesB3: hasSummary ? num(p.historySalesB3) : null,
        cashbackSnapshot: hasSummary ? num(p.cashbackSnapshot) : null,
      };
    }),
    entertainItems: d.entertainItems.map((e: any) => ({
      id: e.id,
      periodeMonth: e.periodeMonth,
      biayaEntertain: num(e.biayaEntertain),
    })),
    auditLogs: (d.auditLogs || []).map((log: any) => ({
      id: log.id,
      poaScId: log.poaScId,
      actorId: log.actorId,
      action: log.action,
      fromStatus: log.fromStatus,
      toStatus: log.toStatus,
      snapshot: log.snapshot,
      createdAt: log.createdAt,
      actor: log.actor
        ? { nip: log.actor.nip, name: log.actor.name, role: log.actor.role, jabatan: log.actor.jabatan }
        : null,
    })),
    updatedAt: d.updatedAt,
    createdAt: d.createdAt,
  };
}
