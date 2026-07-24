import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips } from "@/lib/authz";
import { getAllPakets } from "@/lib/paketProduk";
import { Card } from "@/components/ui/Card";
import { MonitoringChecklist } from "@/components/poa/MonitoringChecklist";
import type { MonitoringGroup, MonitoringTotals } from "@/components/poa/MonitoringChecklist";
import { TerritoryTable } from "@/components/poa/TerritoryTable";

export const metadata = { title: "Summary · Form POA" };

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "outlet" | "customer" | "produk" | "mr";

interface SalesDummy {
  historis2025: number;
  salesYtd: number;
  salesPlusEst: number;
  growthPct: number;
  achievementPct: number;
}

interface TerritoryGroup {
  code: string;
  name: string;
  pic: string;
  estimasi: number;
  variasiProduk: number;
  variasiProdukFokus: number;
  produkPssp: number;
  customer: number;
  pengajuan: number;
  terstandarisasi: number;
  prosesStandar: number;
  gap: number;
  psspTotal: number;
  discountTotal: number;
  entertainTotal: number;
  budgetTotal: number;
  realisasi: number;
  gapVsRealisasi: number;
  sales: SalesDummy;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNum(v: { toString(): string } | number | string | null | undefined): number {
  return parseFloat(String(v ?? 0)) || 0;
}

// Deterministic dummy sales — same territory code → same numbers
function dummySales(code: string, estimasi: number): SalesDummy {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (Math.imul(31, h) + code.charCodeAt(i)) | 0;
  h = Math.abs(h);
  const base = Math.max(estimasi, 5_000_000);
  const mult = 10 + (h % 10);
  const historis2025 = base * mult;
  const growthFactor = 0.88 + (h % 25) / 100;
  const salesYtd = historis2025 * growthFactor * (7 / 12);
  const growthPct = (growthFactor - 1) * 100;
  const achievementPct = (salesYtd / (historis2025 * 7 / 12)) * 100;
  return { historis2025, salesYtd, salesPlusEst: salesYtd + estimasi, growthPct, achievementPct };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role === "MR") redirect("/dashboard");

  const params = await searchParams;
  const tab: Tab = (params.tab as Tab) ?? "mr";
  const periodFilter = params.period ?? null;

  // ── Data ──────────────────────────────────────────────────────────────────

  // Shared helper (not a local reimplementation) so ADMIN/GM correctly see
  // every MR company-wide instead of walking nipAtasan from their own NIP —
  // neither role reports to/from anyone in that chain, so the old local
  // getSubordinateMRNips(nip) always returned an empty list for them
  // (2026-07-23 fix: "sebagai admin harusnya summary-nya kelihatan semua").
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const mrNips = await getSubordinateMRNips(actor);

  const mrUsers = mrNips.length > 0
    ? (await prisma.user.findMany({
        where: { nip: { in: mrNips } },
        orderBy: { name: "asc" },
      })) as { nip: string; name: string }[]
    : [];

  const NON_DRAFT = ["APPROVED_BY_ASM", "APPROVED_BY_SM", "APPROVED_BY_NSM"];
  const poaWhere: Record<string, unknown> = { ownerId: { in: mrNips }, status: { in: NON_DRAFT } };
  if (periodFilter) poaWhere.period = periodFilter;

  const [poas, allPoasForPeriods] = await Promise.all([
    mrNips.length > 0 ? prisma.poaForm.findMany({ where: poaWhere }) as Promise<{ id: string; ownerId: string; period: string }[]> : Promise.resolve([]),
    mrNips.length > 0 ? prisma.poaForm.findMany({ where: { ownerId: { in: mrNips }, status: { in: NON_DRAFT } } }) as Promise<{ period: string }[]> : Promise.resolve([]),
  ]);

  const allPeriods = [...new Set(allPoasForPeriods.map((p) => p.period))].sort();
  const poaIds = poas.map((p) => p.id);

  const lineItems = poaIds.length > 0
    ? (await prisma.poaLineItem.findMany({ where: { poaId: { in: poaIds } } })) as {
        poaId: string;
        kodePI: string | null;
        kodeCust: string | null;
        namaCust: string;
        namaProduk: string;
        kodeProduk: string;
        statusStandarisasi: string | null;
        rencanaTotalBiaya: { toString(): string } | number;
        persenPsspDokter: { toString(): string } | number | null;
        persenDiskon: { toString(): string } | number | null;
        persenDp: { toString(): string } | number | null;
        persenListingFee: { toString(): string } | number | null;
        persenEntertain: { toString(): string } | number | null;
        pengaliNilaiR: { toString(): string } | number | null;
      }[]
    : [];

  // Outlet names for the "outlet" tab
  const outletCodes = [...new Set(lineItems.map((li) => li.kodePI).filter(Boolean) as string[])];
  const outletRows = outletCodes.length > 0
    ? (await prisma.outlet.findMany({
        where: { kodePI: { in: outletCodes } },
        select: { kodePI: true, namaOutlet: true },
      })) as { kodePI: string; namaOutlet: string }[]
    : [];
  const outletMap = new Map(outletRows.map((o) => [o.kodePI, o]));

  // Realisasi sebelumnya — every PSSP kontrak (running or already finished;
  // PsspKontrak has no separate "active" flag, prdAkhir in the past just
  // means it's done) aggregated by outlet and by customer, so the "outlet"
  // and "customer" tabs can be sorted by gap = estimasi sekarang - realisasi
  // sebelumnya (2026-07-24 request: surface "dulu jelek kok estimasinya
  // tinggi sekarang" outlets/customers at the top instead of by raw estimasi).
  const custCodes = [...new Set(lineItems.map((li) => li.kodeCust).filter(Boolean) as string[])];
  const [realisasiByOutletRaw, realisasiByCustRaw] = await Promise.all([
    outletCodes.length > 0
      ? prisma.psspKontrak.groupBy({ by: ["kdOutlet"], where: { kdOutlet: { in: outletCodes } }, _sum: { totalLunas: true } })
      : Promise.resolve([]),
    custCodes.length > 0
      ? prisma.psspKontrak.groupBy({ by: ["kdCust"], where: { kdCust: { in: custCodes } }, _sum: { totalLunas: true } })
      : Promise.resolve([]),
  ]) as [{ kdOutlet: string | null; _sum: { totalLunas: { toString(): string } | null } }[], { kdCust: string; _sum: { totalLunas: { toString(): string } | null } }[]];
  const realisasiByOutlet = new Map(realisasiByOutletRaw.filter((r) => r.kdOutlet).map((r) => [r.kdOutlet as string, toNum(r._sum.totalLunas)]));
  const realisasiByCust = new Map(realisasiByCustRaw.map((r) => [r.kdCust, toNum(r._sum.totalLunas)]));

  // Build poa→owner map
  const poaOwnerMap = new Map(poas.map((p) => [p.id, p.ownerId]));

  // ── Global unique totals (avoids cross-group double-counting) ─────────────

  const psspProdSet = new Set<string>();
  for (const li of lineItems) {
    const psspp = toNum(li.persenPsspDokter);
    if (psspp > 0) psspProdSet.add(li.kodeProduk);
  }

  const sudahSet = new Set(
    lineItems.filter((li) => li.statusStandarisasi === "SUDAH_STANDARISASI").map((li) => li.kodeProduk)
  );
  const prosesSet = new Set(
    lineItems
      .filter((li) => li.statusStandarisasi === "PROSES_PENGAJUAN" && !sudahSet.has(li.kodeProduk))
      .map((li) => li.kodeProduk)
  );
  const allProductSet = new Set(lineItems.map((li) => li.kodeProduk));

  const globalTotals: MonitoringTotals = {
    customer: new Set(lineItems.map((li) => li.namaCust)).size,
    variasiProdukFokus: new Set(
      lineItems.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)
    ).size,
    produkPssp: psspProdSet.size,
    sudahStandar: sudahSet.size,
    prosesStandar: prosesSet.size,
    totalUniqueProducts: allProductSet.size,
  };

  // ── Territory grouping ────────────────────────────────────────────────────

  type TerritoryKey = { code: string; name: string };

  function getTerritoryKey(li: typeof lineItems[0]): TerritoryKey {
    if (tab === "outlet") {
      const o = li.kodePI ? outletMap.get(li.kodePI) : null;
      return { code: li.kodePI ?? "—", name: o?.namaOutlet ?? "Tidak Diketahui" };
    }
    if (tab === "produk") {
      return { code: li.kodeProduk, name: li.namaProduk };
    }
    if (tab === "customer") {
      return { code: li.kodeCust ?? `no-code:${li.namaCust}`, name: li.namaCust };
    }
    const ownerNip = poaOwnerMap.get(li.poaId) ?? "—";
    const mr = mrUsers.find((u) => u.nip === ownerNip);
    return { code: ownerNip, name: mr?.name ?? ownerNip };
  }

  // An outlet's PIC is whichever MR(s) currently hold that specific
  // MrOutletAssignment — a SHADOW-pair outlet can have more than one holder.
  const mrOutletRows = mrNips.length > 0
    ? (await prisma.mrOutletAssignment.findMany({
        where: { nipMR: { in: mrNips } },
        select: { nipMR: true, kodePI: true },
      })) as { nipMR: string; kodePI: string }[]
    : [];
  const mrNamesByOutlet = new Map<string, string[]>();
  for (const row of mrOutletRows) {
    const mrName = mrUsers.find((u) => u.nip === row.nipMR)?.name ?? row.nipMR;
    const list = mrNamesByOutlet.get(row.kodePI) ?? [];
    list.push(mrName);
    mrNamesByOutlet.set(row.kodePI, list);
  }

  function findPic(code: string): string {
    if (tab === "mr") {
      const mr = mrUsers.find((u) => u.nip === code);
      return mr?.name ?? code;
    }
    if (tab === "outlet") {
      const names = mrNamesByOutlet.get(code);
      return names && names.length > 0 ? names.join(" / ") : "—";
    }
    return "—"; // "produk" tab — no single PIC concept for a product
  }

  const groupMap = new Map<string, { key: TerritoryKey; items: typeof lineItems }>();

  if (tab === "mr") {
    for (const mr of mrUsers) {
      groupMap.set(mr.nip, { key: { code: mr.nip, name: mr.name }, items: [] });
    }
  } else if (tab === "outlet") {
    const outletKodesForMR = [...new Set(mrOutletRows.map((r) => r.kodePI))];
    const mrOutletDetails = outletKodesForMR.length > 0
      ? (await prisma.outlet.findMany({
          where: { kodePI: { in: outletKodesForMR } },
          select: { kodePI: true, namaOutlet: true },
        })) as { kodePI: string; namaOutlet: string }[]
      : [];
    for (const o of mrOutletDetails) {
      if (!groupMap.has(o.kodePI)) groupMap.set(o.kodePI, { key: { code: o.kodePI, name: o.namaOutlet }, items: [] });
    }
  }
  // "produk" tab: no pre-seeding — products only appear once actually planned.

  for (const li of lineItems) {
    const key = getTerritoryKey(li);
    if (!groupMap.has(key.code)) groupMap.set(key.code, { key, items: [] });
    groupMap.get(key.code)!.items.push(li);
  }

  const groups: TerritoryGroup[] = [...groupMap.values()]
    .map(({ key, items }) => {
      let estimasi = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
      const produkPsspSet = new Set<string>();
      for (const li of items) {
        const base = toNum(li.rencanaTotalBiaya);
        const pengaliNilaiR = li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1;
        const psspPct = toNum(li.persenPsspDokter) * pengaliNilaiR;
        const discPct = toNum(li.persenDiskon) + toNum(li.persenDp) + toNum(li.persenListingFee);
        const entPct  = toNum(li.persenEntertain);
        estimasi       += base;
        psspTotal      += base * psspPct;
        discountTotal  += base * discPct;
        entertainTotal += base * entPct;
        if (psspPct > 0) produkPsspSet.add(li.kodeProduk);
      }
      const terstandarisasi = items.filter((li) => li.statusStandarisasi === "SUDAH_STANDARISASI").length;
      const prosesStandar   = items.filter((li) => li.statusStandarisasi === "PROSES_PENGAJUAN").length;
      const realisasi = tab === "outlet" ? (realisasiByOutlet.get(key.code) ?? 0)
        : tab === "customer" ? (realisasiByCust.get(key.code) ?? 0)
        : 0;
      return {
        code: key.code,
        name: key.name,
        pic: findPic(key.code),
        estimasi,
        variasiProduk: new Set(items.map((li) => li.kodeProduk)).size,
        variasiProdukFokus: new Set(items.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)).size,
        produkPssp: produkPsspSet.size,
        customer: new Set(items.map((li) => li.namaCust)).size,
        pengajuan: items.length,
        terstandarisasi,
        prosesStandar,
        gap: items.length - terstandarisasi,
        psspTotal,
        discountTotal,
        entertainTotal,
        budgetTotal: psspTotal + discountTotal + entertainTotal,
        realisasi,
        gapVsRealisasi: estimasi - realisasi,
        sales: dummySales(key.code, estimasi),
      };
    })
    // "outlet"/"customer": biggest gap between current estimasi and prior
    // realisasi first — flags "dulu jelek kok estimasinya tinggi sekarang".
    // Other tabs have no realisasi concept, so they keep the old estimasi sort.
    .sort((a, b) => (tab === "outlet" || tab === "customer")
      ? b.gapVsRealisasi - a.gapVsRealisasi
      : b.estimasi - a.estimasi);

  // ── Tab labels ────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string }[] = [
    { key: "outlet",   label: "Per Outlet" },
    { key: "customer", label: "Per Customer" },
    { key: "produk",   label: "Per Produk" },
    { key: "mr",       label: "Per Personil" },
  ];
  const CODE_LABEL: Record<Tab, string> = {
    outlet: "Outlet", customer: "Customer", produk: "Produk", mr: "Personil",
  };

  const monitoringGroups: MonitoringGroup[] = groups.map((g) => ({
    code: g.code,
    name: g.name,
    pic: g.pic,
    estimasi: g.estimasi,
    variasiProduk: g.variasiProduk,
    variasiProdukFokus: g.variasiProdukFokus,
    produkPssp: g.produkPssp,
    customer: g.customer,
    pengajuan: g.pengajuan,
    terstandarisasi: g.terstandarisasi,
    prosesStandar: g.prosesStandar,
    gap: g.gap,
    psspTotal: g.psspTotal,
    discountTotal: g.discountTotal,
    entertainTotal: g.entertainTotal,
    budgetTotal: g.budgetTotal,
    realisasi: g.realisasi,
    gapVsRealisasi: g.gapVsRealisasi,
    historis2025: g.sales.historis2025,
    salesYtd: g.sales.salesYtd,
    salesPlusEst: g.sales.salesPlusEst,
    growthPct: g.sales.growthPct,
    achievementPct: g.sales.achievementPct,
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Summary POA</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {mrUsers.length} MR · {poas.length} POA · {lineItems.length} pengajuan
          </p>
        </div>

        {/* Period filter */}
        {allPeriods.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Link href={`/summary?tab=${tab}`}
              className="rounded px-2.5 py-1 text-xs font-medium border"
              style={!periodFilter
                ? { background: "var(--color-blue)", color: "#fff", borderColor: "var(--color-blue)" }
                : { color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}>
              Semua
            </Link>
            {allPeriods.map((p) => (
              <Link key={p} href={`/summary?tab=${tab}&period=${p}`}
                className="rounded px-2.5 py-1 text-xs font-medium border"
                style={periodFilter === p
                  ? { background: "var(--color-blue)", color: "#fff", borderColor: "var(--color-blue)" }
                  : { color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}>
                {p}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <Card padded={false}>
        <div className="flex gap-0 border-b overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          {TABS.map((t) => (
            <Link key={t.key}
              href={`/summary?tab=${t.key}${periodFilter ? `&period=${periodFilter}` : ""}`}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
              style={tab === t.key
                ? { borderColor: "var(--color-blue)", color: "var(--color-blue)" }
                : { borderColor: "transparent", color: "var(--color-text-muted)" }}>
              {t.label}
            </Link>
          ))}
        </div>
      </Card>

      {/* Stats */}
      <MonitoringChecklist groups={monitoringGroups} totals={globalTotals} />

      {/* Per-row breakdown for the active tab — Ringkasan above only shows the
          grand total, this is what actually differs between tabs. */}
      <TerritoryTable groups={monitoringGroups} codeLabel={CODE_LABEL[tab]} showRealisasi={tab === "outlet" || tab === "customer"} />
    </div>
  );
}
