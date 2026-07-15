import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Monitoring · Form POA" };

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "reg" | "area" | "sub" | "gt" | "mr";

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
  customer: number;
  pengajuan: number;
  terstandarisasi: number;
  gap: number;
  sales: SalesDummy;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(2).replace(".", ",")} M`;
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(2).replace(".", ",")} Jt`;
  return "Rp" + n.toLocaleString("id-ID");
}

function toNum(v: { toString(): string } | number | string): number {
  return parseFloat(String(v)) || 0;
}

// Deterministic dummy sales — same territory code → same numbers
// Replace this function body when real sales data is available
function dummySales(code: string, estimasi: number): SalesDummy {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (Math.imul(31, h) + code.charCodeAt(i)) | 0;
  h = Math.abs(h);
  const base = Math.max(estimasi, 5_000_000);
  const mult = 10 + (h % 10);                        // 10–20× estimasi
  const historis2025 = base * mult;
  const growthFactor = 0.88 + (h % 25) / 100;        // -12% … +13%
  const salesYtd = historis2025 * growthFactor * (7 / 12);  // YTD s/d Juli
  const growthPct = (growthFactor - 1) * 100;
  const achievementPct = (salesYtd / (historis2025 * 7 / 12)) * 100;
  return { historis2025, salesYtd, salesPlusEst: salesYtd + estimasi, growthPct, achievementPct };
}

function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

async function getSubordinateMRNips(nip: string): Promise<string[]> {
  const mrNips: string[] = [];
  let frontier = [nip];
  for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
    const subs = await prisma.user.findMany({
      where: { nipAtasan: { in: frontier }, isActive: true },
    }) as { nip: string; role: string }[];
    if (!subs.length) break;
    mrNips.push(...subs.filter((u) => u.role === "MR").map((u) => u.nip));
    frontier = subs.filter((u) => u.role !== "MR").map((u) => u.nip);
  }
  return mrNips;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MonitoringPage({
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

  const mrNips = await getSubordinateMRNips(session.userId);

  const mrUsers = mrNips.length > 0
    ? (await prisma.user.findMany({
        where: { nip: { in: mrNips } },
        orderBy: { name: "asc" },
      })) as { nip: string; name: string; kodeWilayah: string | null; namaWilayah: string | null }[]
    : [];

  // Only count fully-approved POAs in monitoring
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
        namaCust: string;
        kodeProduk: string;
        statusStandarisasi: string | null;
        rencanaTotalBiaya: { toString(): string } | number;
      }[]
    : [];

  // Get outlet territory for line items
  const outletCodes = [...new Set(lineItems.map((li) => li.kodePI).filter(Boolean) as string[])];
  const outletRows = outletCodes.length > 0
    ? (await prisma.outlet.findMany({ where: { kodePI: { in: outletCodes } } })) as {
        kodePI: string; kodeGT: string | null; namaGT: string | null;
        kodeSub: string | null; namaSub: string | null;
        kodeArea: string | null; namaArea: string | null;
        kodeReg: string | null; namaReg: string | null;
      }[]
    : [];
  const outletMap = new Map(outletRows.map((o) => [o.kodePI, o]));

  // Build poa→owner map
  const poaOwnerMap = new Map(poas.map((p) => [p.id, p.ownerId]));

  // ── Summary ───────────────────────────────────────────────────────────────

  const totalEstimasi = lineItems.reduce((s, li) => s + toNum(li.rencanaTotalBiaya), 0);
  const variasiProduk = new Set(lineItems.map((li) => li.kodeProduk)).size;
  const totalCustomer = new Set(lineItems.map((li) => li.namaCust)).size;
  const totalPengajuan = lineItems.length;
  const totalStandar = lineItems.filter((li) => li.statusStandarisasi === "SUDAH_STANDARISASI").length;
  const gapPengajuan = totalPengajuan - totalStandar;

  // ── Territory grouping ────────────────────────────────────────────────────

  type TerritoryKey = { code: string; name: string };

  function getTerritoryKey(li: typeof lineItems[0]): TerritoryKey {
    const o = li.kodePI ? outletMap.get(li.kodePI) : null;
    if (tab === "reg")  return { code: o?.kodeReg  ?? "—", name: o?.namaReg  ?? "Tidak Diketahui" };
    if (tab === "area") return { code: o?.kodeArea ?? "—", name: o?.namaArea ?? "Tidak Diketahui" };
    if (tab === "sub")  return { code: o?.kodeSub  ?? "—", name: o?.namaSub  ?? "Tidak Diketahui" };
    if (tab === "gt")   return { code: o?.kodeGT   ?? "—", name: o?.namaGT   ?? "Tidak Diketahui" };
    // "mr"
    const ownerNip = poaOwnerMap.get(li.poaId) ?? "—";
    const mr = mrUsers.find((u) => u.nip === ownerNip);
    return { code: ownerNip, name: mr?.name ?? ownerNip };
  }

  // Build territory → PIC map using User.kodeWilayah
  const allSubordinates = (await prisma.user.findMany({
    where: { nip: { in: mrNips } },
  })) as { nip: string; name: string; role: string; kodeWilayah: string | null }[];

  function findPic(code: string): string {
    if (tab === "mr") {
      const mr = mrUsers.find((u) => u.nip === code);
      return mr?.name ?? code;
    }
    const roleForTab = { reg: "SM", area: "ASM", sub: "MR", gt: "MR" }[tab];
    const user = allSubordinates.find((u) => u.role === roleForTab && u.kodeWilayah === code);
    return user?.name ?? "—";
  }

  // Aggregate groups — start by pre-populating from MR/territory list so rows always appear
  const groupMap = new Map<string, { key: TerritoryKey; items: typeof lineItems }>();

  if (tab === "mr") {
    for (const mr of mrUsers) {
      groupMap.set(mr.nip, { key: { code: mr.nip, name: mr.name }, items: [] });
    }
  } else {
    // For territory tabs, derive groups from outlets assigned to each MR
    const mrOutletRows = mrNips.length > 0
      ? (await prisma.mrOutletAssignment.findMany({
          where: { nipMR: { in: mrNips } },
          select: { nipMR: true, kodePI: true },
        })) as { nipMR: string; kodePI: string }[]
      : [];

    const outletKodesForMR = [...new Set(mrOutletRows.map((r) => r.kodePI))];
    const mrOutletDetails = outletKodesForMR.length > 0
      ? (await prisma.outlet.findMany({
          where: { kodePI: { in: outletKodesForMR } },
          select: { kodePI: true, kodeGT: true, namaGT: true, kodeSub: true, namaSub: true, kodeArea: true, namaArea: true, kodeReg: true, namaReg: true },
        })) as { kodePI: string; kodeGT: string | null; namaGT: string | null; kodeSub: string | null; namaSub: string | null; kodeArea: string | null; namaArea: string | null; kodeReg: string | null; namaReg: string | null }[]
      : [];
    const outletDetailMap = new Map(mrOutletDetails.map((o) => [o.kodePI, o]));

    for (const row of mrOutletRows) {
      const o = outletDetailMap.get(row.kodePI);
      if (!o) continue;
      let code: string | null = null;
      let name: string | null = null;
      if (tab === "gt")   { code = o.kodeGT;   name = o.namaGT; }
      if (tab === "sub")  { code = o.kodeSub;  name = o.namaSub; }
      if (tab === "area") { code = o.kodeArea; name = o.namaArea; }
      if (tab === "reg")  { code = o.kodeReg;  name = o.namaReg; }
      if (code && !groupMap.has(code)) {
        groupMap.set(code, { key: { code, name: name ?? code }, items: [] });
      }
    }
  }

  for (const li of lineItems) {
    const key = getTerritoryKey(li);
    if (!groupMap.has(key.code)) groupMap.set(key.code, { key, items: [] });
    groupMap.get(key.code)!.items.push(li);
  }

  const groups: TerritoryGroup[] = [...groupMap.values()]
    .map(({ key, items }) => {
      const estimasi = items.reduce((s, li) => s + toNum(li.rencanaTotalBiaya), 0);
      const terstandarisasi = items.filter((li) => li.statusStandarisasi === "SUDAH_STANDARISASI").length;
      return {
        code: key.code,
        name: key.name,
        pic: findPic(key.code),
        estimasi,
        variasiProduk: new Set(items.map((li) => li.kodeProduk)).size,
        customer: new Set(items.map((li) => li.namaCust)).size,
        pengajuan: items.length,
        terstandarisasi,
        gap: items.length - terstandarisasi,
        sales: dummySales(key.code, estimasi),
      };
    })
    .sort((a, b) => b.estimasi - a.estimasi);

  // ── Tab labels ────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string }[] = [
    { key: "reg",  label: "Region" },
    { key: "area", label: "Area" },
    { key: "sub",  label: "Sub Area" },
    { key: "gt",   label: "GT" },
    { key: "mr",   label: "Per MR" },
  ];

  // ── UI ────────────────────────────────────────────────────────────────────

  const summaryCards = [
    { label: "Estimasi Total", value: formatRp(totalEstimasi) },
    { label: "Variasi Produk", value: variasiProduk.toString(), sub: "produk unik" },
    { label: "Total Customer", value: totalCustomer.toString(), sub: "dokter" },
    { label: "Total Pengajuan", value: totalPengajuan.toString(), sub: "baris" },
    { label: "Terstandarisasi", value: totalStandar.toString(), sub: totalPengajuan > 0 ? `${Math.round((totalStandar / totalPengajuan) * 100)}%` : "—" },
    { label: "Gap Listing", value: gapPengajuan.toString(), sub: "belum listing", warn: gapPengajuan > 0 },
  ];

  const colHeaders = ["Wilayah", "PIC", "Historis 2025 ★", "Sales YTD 2026 ★", "Sales+Est ★", "Growth YTD ★", "Ach. YTD ★", "Estimasi POA", "Variasi Produk", "Customer", "Pengajuan", "Terstandarisasi", "Gap"];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Monitoring POA</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {mrUsers.length} MR · {poas.length} POA · {lineItems.length} pengajuan
          </p>
        </div>

        {/* Period filter */}
        {allPeriods.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Link
              href={`/monitoring?tab=${tab}`}
              className="rounded px-2.5 py-1 text-xs font-medium border"
              style={!periodFilter
                ? { background: "var(--color-blue)", color: "#fff", borderColor: "var(--color-blue)" }
                : { color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
            >
              Semua
            </Link>
            {allPeriods.map((p) => (
              <Link key={p} href={`/monitoring?tab=${tab}&period=${p}`}
                className="rounded px-2.5 py-1 text-xs font-medium border"
                style={periodFilter === p
                  ? { background: "var(--color-blue)", color: "#fff", borderColor: "var(--color-blue)" }
                  : { color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
              >
                {p}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((c) => (
          <Card key={c.label} padded={false} className="p-4">
            <p className="text-xs mb-1 truncate" style={{ color: "var(--color-text-muted)" }}>{c.label}</p>
            <p className="text-xl font-semibold" style={{ color: c.warn ? "var(--color-danger, #dc2626)" : "var(--color-text)" }}>
              {c.value}
            </p>
            {c.sub && <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{c.sub}</p>}
          </Card>
        ))}
      </div>

      {/* Tabs + Table */}
      <Card padded={false}>
        {/* Tab bar */}
        <div className="flex gap-0 border-b overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/monitoring?tab=${t.key}${periodFilter ? `&period=${periodFilter}` : ""}`}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
              style={tab === t.key
                ? { borderColor: "var(--color-blue)", color: "var(--color-blue)" }
                : { borderColor: "transparent", color: "var(--color-text-muted)" }}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* Dummy data notice */}
        <div className="px-4 py-2 text-xs border-b flex items-center gap-1.5"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
          <span>★</span>
          <span>Kolom Historis 2025, Sales YTD, Growth, dan Achievement menggunakan <strong>data dummy</strong> — akan diganti data aktual dari sistem sales.</span>
        </div>

        {/* Table */}
        {groups.length === 0 ? (
          <p className="py-12 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
            Belum ada data pengajuan.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {colHeaders.map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap"
                      style={{ color: "var(--color-text-faint)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.code} className="border-b last:border-0 hover:bg-(--color-bg-subtle)"
                    style={{ borderColor: "var(--color-border)" }}>
                    <td className="px-4 py-3 min-w-[160px]">
                      <p className="font-medium" style={{ color: "var(--color-text)" }}>{g.name}</p>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{g.code}</p>
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{g.pic}</td>

                    {/* ── Sales columns (dummy) ── */}
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--color-text)" }}>{formatRp(g.sales.historis2025)}</td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--color-text)" }}>{formatRp(g.sales.salesYtd)}</td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--color-text)" }}>{formatRp(g.sales.salesPlusEst)}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className="rounded px-1.5 py-0.5 text-xs font-medium"
                        style={g.sales.growthPct >= 0
                          ? { background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }
                          : { background: "var(--color-error-bg, #fee2e2)", color: "var(--color-danger, #dc2626)" }}>
                        {pct(g.sales.growthPct)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className="rounded px-1.5 py-0.5 text-xs font-medium"
                        style={g.sales.achievementPct >= 100
                          ? { background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }
                          : { background: "var(--color-error-bg, #fee2e2)", color: "var(--color-danger, #dc2626)" }}>
                        {g.sales.achievementPct.toFixed(1)}%
                      </span>
                    </td>

                    {/* ── POA columns ── */}
                    <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>{formatRp(g.estimasi)}</td>
                    <td className="px-4 py-3 text-center" style={{ color: "var(--color-text)" }}>{g.variasiProduk}</td>
                    <td className="px-4 py-3 text-center">
                      <span style={{ color: g.customer < 30 ? "var(--color-danger, #dc2626)" : "var(--color-text)" }}>
                        {g.customer}
                      </span>
                      {g.customer < 30 && g.pengajuan > 0 && (
                        <span className="ml-1 text-xs" style={{ color: "var(--color-danger, #dc2626)" }}>▼</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center" style={{ color: "var(--color-text)" }}>{g.pengajuan}</td>
                    <td className="px-4 py-3 text-center" style={{ color: "var(--color-text)" }}>{g.terstandarisasi}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded px-2 py-0.5 text-xs font-medium"
                        style={g.gap > 0
                          ? { background: "var(--color-error-bg, #fee2e2)", color: "var(--color-danger, #dc2626)" }
                          : { background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}>
                        {g.gap}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {groups.length > 1 && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--color-border)", background: "var(--color-bg-subtle)" }}>
                    <td className="px-4 py-3 text-xs font-semibold" style={{ color: "var(--color-text)" }} colSpan={2}>TOTAL</td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                      {formatRp(groups.reduce((s, g) => s + g.sales.historis2025, 0))}
                    </td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                      {formatRp(groups.reduce((s, g) => s + g.sales.salesYtd, 0))}
                    </td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                      {formatRp(groups.reduce((s, g) => s + g.sales.salesPlusEst, 0))}
                    </td>
                    <td className="px-4 py-3 text-center" colSpan={2} style={{ color: "var(--color-text-muted)", fontSize: "0.7rem" }}>—</td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text)" }}>{formatRp(totalEstimasi)}</td>
                    <td className="px-4 py-3 text-center font-semibold" style={{ color: "var(--color-text)" }}>{variasiProduk}</td>
                    <td className="px-4 py-3 text-center font-semibold" style={{ color: "var(--color-text)" }}>{totalCustomer}</td>
                    <td className="px-4 py-3 text-center font-semibold" style={{ color: "var(--color-text)" }}>{totalPengajuan}</td>
                    <td className="px-4 py-3 text-center font-semibold" style={{ color: "var(--color-text)" }}>{totalStandar}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded px-2 py-0.5 text-xs font-semibold"
                        style={gapPengajuan > 0
                          ? { background: "var(--color-error-bg, #fee2e2)", color: "var(--color-danger, #dc2626)" }
                          : { background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}>
                        {gapPengajuan}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
