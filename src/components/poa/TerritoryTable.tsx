"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { SortableTh, compareSortValues, type SortDir } from "@/components/ui/SortableTh";
import { HeaderInfo } from "@/components/ui/HeaderInfo";

function formatRp(n: number) {
  // Magnitude thresholds must compare on ABS(n) — a negative Gap (e.g.
  // estimasi < realisasi sebelumnya) is well below the raw 1_000_000
  // threshold and used to fall through to the raw-digit branch instead of
  // "-X,X Jt" (2026-07-31 bug report).
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (abs >= 1_000_000)     return `${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return Math.round(n).toLocaleString("id-ID");
}

type Variant = "outlet" | "customer" | "spesialisasi" | "produk" | "mr";

// Decoupled from MonitoringChecklist's old MonitoringGroup (that component and
// its Ringkasan card were removed 2026-07-31) — lists exactly the fields this
// table actually reads, structurally satisfied by summary/page.tsx's own
// TerritoryGroup (which has these plus more; TS structural typing allows that).
export interface TerritoryTableGroup {
  code: string;
  name: string;
  pic: string;
  estimasi: number;
  estimasiAktif: number;
  estimasiQuarterIni: number;
  realisasiQuarterSebelumnya: number;
  growthVsQuarterSebelumnyaPct: number | null;
  budgetTotal: number;
  biayaAktif: number;
  customer: number;
  userPsspAktif: number;
  userPsspAktifEstimasi: number;
  variasiProduk: number;
  variasiProdukKontes: number;
  pengajuan: number;
  terstandarisasi: number;
  salesAktif: number;
  listingFeeTotal: number;
  pelunasanRunningRate: number | null;
  avgPasienPerUser: number | null;
  avgStPerPasien: number | null;
  // "spesialisasi" variant only — see TerritoryGroup in summary/page.tsx.
  customerSebelumnya: number;
  growthCustomerPct: number | null;
}

function fmtNum(n: number | null, digits = 1): string {
  return n != null ? n.toFixed(digits) : "-";
}

type SortKey =
  | "name" | "estimasi" | "growth" | "realisasi" | "gap" | "user" | "variasi" | "pengajuan"
  | "biaya" | "costRatio" | "estimasiPerUser" | "listingFee" | "pelunasan"
  | "salesPerUser" | "avgPasien" | "avgSt" | "listing" | "growthCustomer";

/** Every value the table can be sorted by, computed once per row up front so
 * both rendering and sorting read the same numbers (2026-07-27 Matriks work
 * computed most of these inline during render — hoisted out here so sorting
 * doesn't have to duplicate that math). */
interface EnrichedRow {
  g: TerritoryTableGroup;
  budgetPct: number | null;
  estimasiAktifPengajuan: number;
  biayaAktifPengajuan: number;
  costRatioTotal: number | null;
  userCount: number;
  estimasiPerUser: number | null;
  salesPerUser: number | null;
}

/**
 * Per-row breakdown behind whichever tab is active on /summary (Outlet,
 * Customer, Produk, or Per MR) — this is the whole page's content now that
 * the Ringkasan grand-total card above it was removed (2026-07-31); before
 * that, MonitoringChecklist only showed the grand total, so without this
 * table switching tabs had no visible effect (2026-07-23: the whole point of
 * "bisa lihat per outlet, per personil" is seeing the individual rows, not
 * just one aggregate card).
 *
 * `variant === "outlet"` / `"produk"` add the extra columns from the Matriks
 * Summary Per Outlet / Per Produk request (2026-07-27) — Estimasi Per User and
 * Sales Per User are derived here (not stored) since they're a simple ratio of
 * two fields already on the group.
 *
 * Sortable column headers (2026-07-30 request: "tombol sort by nya juga...
 * berlaku untuk summary") replace the old GAP/Estimasi pill toggle — every
 * numeric column here is clickable, not just those two. Starts unsorted
 * (server's own default order, whatever /summary computed — see sort in
 * summary/page.tsx); click a header to sort by it, click again to flip
 * direction.
 */
export function TerritoryTable({ groups, codeLabel, showRealisasi = false, variant = "mr", quarterIni, quarterSebelumnya }: {
  groups: TerritoryTableGroup[]; codeLabel: string; showRealisasi?: boolean; variant?: Variant;
  /** The two quarters compared by the "Growth vs Quarter Sebelumnya" column — shown in its header/tooltip so the comparison baseline isn't a black box. */
  quarterIni?: string | null;
  quarterSebelumnya?: string | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const isOutlet = variant === "outlet";
  const isProduk = variant === "produk";
  const isSpes = variant === "spesialisasi";
  const isMr = variant === "mr";
  const isCustomer = variant === "customer";

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const enriched: EnrichedRow[] = useMemo(() => groups.map((g) => {
    const budgetPct = g.estimasi > 0 ? (g.budgetTotal / g.estimasi) * 100 : null;
    const estimasiAktifPengajuan = g.estimasi + g.estimasiAktif;
    const biayaAktifPengajuan = g.biayaAktif + g.budgetTotal;
    const costRatioTotal = estimasiAktifPengajuan > 0 ? (biayaAktifPengajuan / estimasiAktifPengajuan) * 100 : null;
    const userCount = isOutlet ? g.userPsspAktifEstimasi : isProduk ? g.userPsspAktif : g.customer;
    const estimasiPerUser = userCount > 0 ? estimasiAktifPengajuan / userCount : null;
    const salesPerUser = userCount > 0 ? g.salesAktif / userCount : null;
    return { g, budgetPct, estimasiAktifPengajuan, biayaAktifPengajuan, costRatioTotal, userCount, estimasiPerUser, salesPerUser };
  }), [groups, isOutlet, isProduk]);

  function sortValue(row: EnrichedRow, key: SortKey): number | string | null {
    const { g } = row;
    switch (key) {
      case "name": return g.name;
      case "estimasi": return isOutlet || isProduk ? row.estimasiAktifPengajuan : g.estimasi;
      case "growth": return g.growthVsQuarterSebelumnyaPct;
      case "realisasi": return g.realisasiQuarterSebelumnya;
      // Nominal counterpart of the Growth % column (same numerator,
      // estimasiQuarterIni - realisasiQuarterSebelumnya) — null whenever
      // Growth itself is null, so the two never disagree on "no data".
      case "gap": return g.growthVsQuarterSebelumnyaPct != null ? g.estimasiQuarterIni - g.realisasiQuarterSebelumnya : null;
      case "growthCustomer": return g.growthCustomerPct;
      case "user": return row.userCount;
      case "variasi": return g.variasiProdukKontes;
      case "pengajuan": return g.pengajuan;
      case "biaya": return isOutlet || isProduk ? row.biayaAktifPengajuan : g.budgetTotal;
      case "costRatio": return isOutlet || isProduk ? row.costRatioTotal : row.budgetPct;
      case "estimasiPerUser": return row.estimasiPerUser;
      case "listingFee": return g.listingFeeTotal;
      case "pelunasan": return g.pelunasanRunningRate;
      case "salesPerUser": return row.salesPerUser;
      case "avgPasien": return g.avgPasienPerUser;
      case "avgSt": return g.avgStPerPasien;
      case "listing": return g.terstandarisasi;
      default: return null;
    }
  }

  const sortedRows = useMemo(() => {
    if (!sortKey) return enriched;
    return [...enriched].sort((a, b) => compareSortValues(sortValue(a, sortKey), sortValue(b, sortKey), sortDir));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, sortKey, sortDir]);

  if (groups.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
          Belum ada data.
        </p>
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              {/* Frozen first column (2026-07-27 request: "difreeze biar tetep
                  keliatan kalau geser kanan"). */}
              <SortableTh label={codeLabel} sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="left" sticky
                info={`Nama dan kode ${codeLabel.toLowerCase()}.`} />
              {isProduk && (
                <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                  <span className="inline-flex items-center gap-1">
                    Status
                    <HeaderInfo text="Kontes jika produk ini termasuk daftar Produk Kontes perusahaan, Non-Kontes jika bukan." />
                  </span>
                </th>
              )}
              {/* PIC hidden for "mr" (setiap baris SUDAH mewakili satu MR,
                  jadi PIC-nya redundan — 2026-08-06: "di tab Per personil
                  hapus kolom PIC") dan "customer" (2026-08-06: "di tab per
                  Customer hapus kolom Customer dan kolom PIC"). */}
              {!isProduk && !isMr && !isCustomer && (
                <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                  <span className="inline-flex items-center gap-1">
                    PIC
                    <HeaderInfo text="MR (Marketing Representative) yang menangani baris ini." />
                  </span>
                </th>
              )}
              <SortableTh label={isOutlet || isProduk ? "Estimasi Aktif+Pengajuan" : "Estimasi"} sortKey="estimasi" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                info={isOutlet || isProduk
                  ? "Total rencana biaya: 'Aktif' dari kontrak PSSP yang sedang berjalan, 'Pengajuan' dari POA yang sudah disubmit (bukan draft)."
                  : "Total rencana biaya (rencanaTotalBiaya) dari POA yang sudah disubmit, bukan draft."} />
              {showRealisasi && (
                <SortableTh label="Realisasi Quarter Sebelumnya" sortKey="realisasi" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                  title={quarterSebelumnya ? `Realisasi ${quarterSebelumnya}` : undefined}
                  info="Total nilai PSSP yang benar-benar lunas/dibayar dalam kuartal sebelumnya saja (bukan akumulasi sepanjang masa) — baseline yang sama dipakai kolom Growth di sebelah kanan." />
              )}
              <SortableTh label="Growth vs Quarter Sebelumnya" sortKey="growth" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                title={quarterIni && quarterSebelumnya ? `Estimasi ${quarterIni} vs Realisasi ${quarterSebelumnya}` : undefined}
                info="Persentase perbandingan Estimasi (POA yang disubmit) kuartal ini terhadap Realisasi (PSSP lunas) kuartal sebelumnya. Tanda '-' berarti belum ada realisasi kuartal sebelumnya untuk dibandingkan, atau belum ada POA yang disubmit kuartal ini." />
              {showRealisasi && (
                <SortableTh label="Gap" sortKey="gap" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                  info="Selisih Estimasi kuartal ini dikurangi Realisasi kuartal sebelumnya, dalam Rupiah — nilai riil dari persentase yang ditunjukkan kolom Growth di sebelah kiri (tanda sama: hijau = Estimasi di atas Realisasi lalu)." />
              )}
              {isSpes && (
                <SortableTh label="Growth Jumlah Customer" sortKey="growthCustomer" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                  title={quarterIni && quarterSebelumnya ? `Customer ${quarterIni} vs Customer ${quarterSebelumnya}` : undefined}
                  info="Persentase perbandingan JUMLAH customer unik (bukan Rupiah) yang punya realisasi/pengajuan kuartal ini terhadap kuartal sebelumnya, untuk spesialisasi ini. Pelengkap kolom Growth (by value) di sebelah kiri." />
              )}
              {/* "Customer" hidden for the "customer" tab itself — setiap
                  baris SUDAH mewakili satu customer, jadi kolom hitungan
                  customer redundan (2026-08-06: "di tab per Customer hapus
                  kolom Customer dan kolom PIC"). Tetap tampil untuk variant
                  lain (mr/outlet/produk/spesialisasi), yang labelnya juga
                  beda-beda ("User PSSP"/"User Aktif PSSP"/"Customer"). */}
              {!isCustomer && (
                <SortableTh label={isOutlet ? "User PSSP (Aktif+Estimasi)" : isProduk ? "User Aktif PSSP" : "Customer"} sortKey="user" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                  info={isOutlet
                    ? "Jumlah customer unik yang punya PSSP aktif dan/atau diajukan di outlet ini (gabungan, tidak dobel hitung)."
                    : isProduk
                    ? "Jumlah customer unik yang punya PSSP aktif untuk produk ini."
                    : "Jumlah customer unik yang diajukan."} />
              )}
              {isOutlet && (
                <SortableTh label="Variasi Produk (Kontes/Non-Kontes)" sortKey="variasi" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                  info="Jumlah variasi produk yang diajukan di outlet ini, dipecah jadi Kontes dan Non-Kontes." />
              )}
              {!isOutlet && !isProduk && (
                <SortableTh label="Produk Kontes" sortKey="variasi" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                  info="Jumlah variasi Produk Kontes yang diajukan." />
              )}
              <SortableTh label="Pengajuan" sortKey="pengajuan" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                info="Jumlah baris pengajuan (kombinasi produk × customer) yang sudah disubmit, bukan draft." />
              {(isOutlet || isProduk) && (
                <SortableTh label="Biaya" sortKey="biaya" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                  info="Total biaya PSSP + Discount + Entertain: 'Aktif' dari kontrak yang sedang berjalan, 'Pengajuan' dari POA yang diajukan." />
              )}
              <SortableTh label={isOutlet || isProduk ? "Cost Ratio" : "% Budget"} sortKey="costRatio" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                info="Persentase total biaya (PSSP + Discount + Entertain) dibanding Estimasi — makin tinggi, makin besar porsi biaya terhadap rencana penjualan." />
              {isOutlet && (
                <>
                  <SortableTh label="Estimasi Per User" sortKey="estimasiPerUser" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                    info="Estimasi Aktif+Pengajuan dibagi jumlah User PSSP — rata-rata estimasi per customer." />
                  <SortableTh label="Listing Fee" sortKey="listingFee" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                    info="Total nilai kontrak Listing Fee outlet ini." />
                  <SortableTh label="Pelunasan (%) Running Rate" sortKey="pelunasan" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                    info="Realisasi pelunasan dibanding ekspektasi berdasarkan seberapa jauh kontrak sudah berjalan. 100% berarti pelunasan sesuai jadwal, di bawah itu berarti tertinggal." />
                </>
              )}
              {isProduk && (
                <>
                  <SortableTh label="Sales Per User" sortKey="salesPerUser" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                    info="Sales Aktif (qty × HNA) dibagi jumlah User Aktif PSSP." />
                  <SortableTh label="AVG Pasien/User" sortKey="avgPasien" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                    info="Rata-rata jumlah pasien per hari, dihitung dari baris pengajuan yang mengisi data pasien." />
                  <SortableTh label="AVG ST/Pasien" sortKey="avgSt" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                    info="Rata-rata jumlah ST (satuan terkecil produk yang diresepkan) per pasien." />
                </>
              )}
              {!isOutlet && !isProduk && (
                <SortableTh label="Listing" sortKey="listing" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                  info="Jumlah produk berstatus 'Sudah Standarisasi' dibanding total produk yang diajukan." />
              )}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(({ g, budgetPct, estimasiAktifPengajuan, biayaAktifPengajuan, costRatioTotal, userCount, estimasiPerUser, salesPerUser }) => {
              const costRatioAktif = g.estimasiAktif > 0 ? (g.biayaAktif / g.estimasiAktif) * 100 : null;
              const costRatioPengajuan = budgetPct;
              const listingDenom = g.pengajuan;
              return (
                <tr key={g.code} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td className="py-2 px-3 sticky left-0 z-10"
                    style={{ color: "var(--color-text)", background: "var(--color-surface)", borderRight: "1px solid var(--color-border)" }}>
                    <p className="font-medium truncate max-w-[16rem]">{g.name}</p>
                    <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{g.code}</p>
                  </td>
                  {isProduk && (
                    <td className="py-2 px-3 whitespace-nowrap" style={{ color: g.variasiProdukKontes > 0 ? "var(--color-blue)" : "var(--color-text-muted)" }}>
                      {g.variasiProdukKontes > 0 ? "Kontes" : "Non-Kontes"}
                    </td>
                  )}
                  {!isProduk && !isMr && !isCustomer && (
                    <td className="py-2 px-3 whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{g.pic}</td>
                  )}
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    {isOutlet || isProduk ? (
                      <>
                        <div>{estimasiAktifPengajuan > 0 ? formatRp(estimasiAktifPengajuan) : "-"}</div>
                        {(g.estimasiAktif > 0 || g.estimasi > 0) && (
                          <div className="text-[10px] font-normal" style={{ color: "var(--color-text-faint)" }}>
                            Aktif {formatRp(g.estimasiAktif)} · Pengajuan {formatRp(g.estimasi)}
                          </div>
                        )}
                      </>
                    ) : (
                      g.estimasi > 0 ? formatRp(g.estimasi) : "-"
                    )}
                  </td>
                  {showRealisasi && (
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                      {g.realisasiQuarterSebelumnya > 0 ? formatRp(g.realisasiQuarterSebelumnya) : "-"}
                    </td>
                  )}
                  <td className="py-2 px-3 text-right whitespace-nowrap"
                    style={{ color: g.growthVsQuarterSebelumnyaPct == null ? "var(--color-text-faint)"
                      : g.growthVsQuarterSebelumnyaPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                    <div>
                      {g.growthVsQuarterSebelumnyaPct != null
                        ? `${g.growthVsQuarterSebelumnyaPct >= 0 ? "+" : ""}${g.growthVsQuarterSebelumnyaPct.toFixed(1)}%`
                        : "-"}
                    </div>
                    {(g.estimasiQuarterIni > 0 || g.realisasiQuarterSebelumnya > 0) && (
                      <div className="text-[10px] font-normal" style={{ color: "var(--color-text-faint)" }}>
                        Estimasi {quarterIni ?? "ini"} {formatRp(g.estimasiQuarterIni)} · Realisasi {quarterSebelumnya ?? "sebelumnya"} {formatRp(g.realisasiQuarterSebelumnya)}
                      </div>
                    )}
                  </td>
                  {showRealisasi && (
                    <td className="py-2 px-3 text-right whitespace-nowrap"
                      style={{ color: g.growthVsQuarterSebelumnyaPct == null ? "var(--color-text-faint)"
                        : g.growthVsQuarterSebelumnyaPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                      {g.growthVsQuarterSebelumnyaPct != null
                        ? formatRp(g.estimasiQuarterIni - g.realisasiQuarterSebelumnya)
                        : "-"}
                    </td>
                  )}
                  {isSpes && (
                    <td className="py-2 px-3 text-right whitespace-nowrap"
                      style={{ color: g.growthCustomerPct == null ? "var(--color-text-faint)"
                        : g.growthCustomerPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                      <div>
                        {g.growthCustomerPct != null
                          ? `${g.growthCustomerPct >= 0 ? "+" : ""}${g.growthCustomerPct.toFixed(1)}%`
                          : "-"}
                      </div>
                      {g.customerSebelumnya > 0 && (
                        <div className="text-[10px] font-normal" style={{ color: "var(--color-text-faint)" }}>
                          vs {g.customerSebelumnya} customer {quarterSebelumnya ?? "sebelumnya"}
                        </div>
                      )}
                    </td>
                  )}
                  {!isCustomer && (
                    <td className="py-2 px-3 text-right" style={{ color: "var(--color-text)" }}>{userCount}</td>
                  )}
                  {isOutlet && (
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                      {g.variasiProdukKontes}/{g.variasiProduk - g.variasiProdukKontes}
                    </td>
                  )}
                  {!isOutlet && !isProduk && (
                    <td className="py-2 px-3 text-right" style={{ color: "var(--color-text)" }}>{g.variasiProdukKontes}</td>
                  )}
                  <td className="py-2 px-3 text-right" style={{ color: "var(--color-text)" }}>{g.pengajuan}</td>
                  {(isOutlet || isProduk) && (
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                      <div>{biayaAktifPengajuan > 0 ? formatRp(biayaAktifPengajuan) : "-"}</div>
                      {(g.biayaAktif > 0 || g.budgetTotal > 0) && (
                        <div className="text-[10px] font-normal" style={{ color: "var(--color-text-faint)" }}>
                          Aktif {formatRp(g.biayaAktif)} · Pengajuan {formatRp(g.budgetTotal)}
                        </div>
                      )}
                    </td>
                  )}
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    {isOutlet || isProduk ? (
                      <>
                        <div>{costRatioTotal != null ? `${costRatioTotal.toFixed(1)}%` : "-"}</div>
                        {(costRatioAktif != null || costRatioPengajuan != null) && (
                          <div className="text-[10px] font-normal" style={{ color: "var(--color-text-faint)" }}>
                            Aktif {costRatioAktif != null ? `${costRatioAktif.toFixed(1)}%` : "-"}
                            {" · "}
                            Pengajuan {costRatioPengajuan != null ? `${costRatioPengajuan.toFixed(1)}%` : "-"}
                          </div>
                        )}
                      </>
                    ) : (
                      budgetPct != null ? `${budgetPct.toFixed(1)}%` : "-"
                    )}
                  </td>
                  {isOutlet && (
                    <>
                      <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        {estimasiPerUser != null ? formatRp(estimasiPerUser) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        {g.listingFeeTotal > 0 ? formatRp(g.listingFeeTotal) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap"
                        style={{ color: g.pelunasanRunningRate == null ? "var(--color-text-faint)"
                          : g.pelunasanRunningRate >= 100 ? "var(--color-success, #16a34a)"
                          : g.pelunasanRunningRate >= 70 ? "var(--color-warning, #f59e0b)"
                          : "var(--color-red)" }}>
                        {g.pelunasanRunningRate != null ? `${g.pelunasanRunningRate.toFixed(1)}%` : "-"}
                      </td>
                    </>
                  )}
                  {isProduk && (
                    <>
                      <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        {salesPerUser != null ? formatRp(salesPerUser) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        {fmtNum(g.avgPasienPerUser)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        {fmtNum(g.avgStPerPasien)}
                      </td>
                    </>
                  )}
                  {!isOutlet && !isProduk && (
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                      {listingDenom > 0 ? `${g.terstandarisasi}/${listingDenom}` : "-"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
