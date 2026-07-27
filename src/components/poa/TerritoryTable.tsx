import type { MonitoringGroup } from "@/components/poa/MonitoringChecklist";
import { Card } from "@/components/ui/Card";

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `Rp ${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

type Variant = "outlet" | "customer" | "produk" | "mr";

function fmtNum(n: number | null, digits = 1): string {
  return n != null ? n.toFixed(digits) : "—";
}

/**
 * Per-row breakdown behind whichever tab is active on /summary (Region, Area,
 * Sub Area, GT, Outlet, or Per MR) — MonitoringChecklist above only shows the
 * grand total, so without this table switching tabs had no visible effect
 * (2026-07-23: the whole point of "bisa lihat per outlet, per personil" is
 * seeing the individual rows, not just one aggregate card).
 *
 * `variant === "outlet"` / `"produk"` add the extra columns from the Matriks
 * Summary Per Outlet / Per Produk request (2026-07-27) — Estimasi Per User and
 * Sales Per User are derived here (not stored) since they're a simple ratio of
 * two fields already on the group.
 */
export function TerritoryTable({ groups, codeLabel, showRealisasi = false, variant = "mr" }: { groups: MonitoringGroup[]; codeLabel: string; showRealisasi?: boolean; variant?: Variant }) {
  if (groups.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
          Belum ada data.
        </p>
      </Card>
    );
  }

  const isOutlet = variant === "outlet";
  const isProduk = variant === "produk";

  return (
    <Card padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>{codeLabel}</th>
              {isProduk && (
                <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Status</th>
              )}
              {!isProduk && (
                <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>PIC</th>
              )}
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                {isOutlet || isProduk ? "Estimasi Aktif+Pengajuan" : "Estimasi"}
              </th>
              {showRealisasi && (
                <>
                  <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Realisasi Sebelumnya</th>
                  <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Gap</th>
                </>
              )}
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                {isOutlet ? "User PSSP (Aktif+Estimasi)" : isProduk ? "User Aktif PSSP" : "Customer"}
              </th>
              {isOutlet && (
                <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Variasi Produk (Fokus/Non-Fokus)</th>
              )}
              {!isOutlet && !isProduk && (
                <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Produk Fokus</th>
              )}
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Pengajuan</th>
              {(isOutlet || isProduk) && (
                <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Budget</th>
              )}
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                {isOutlet || isProduk ? "Cost Ratio" : "% Budget"}
              </th>
              {(isOutlet || isProduk) && (
                <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Sales Aktif (2026)</th>
              )}
              {isOutlet && (
                <>
                  <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Estimasi Per User</th>
                  <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Listing Fee</th>
                  <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Pelunasan (%) Running Rate</th>
                </>
              )}
              {isProduk && (
                <>
                  <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Sales Per User</th>
                  <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>AVG Pasien/User</th>
                  <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>AVG ST/Pasien</th>
                </>
              )}
              {!isOutlet && !isProduk && (
                <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Listing</th>
              )}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const budgetPct = g.estimasi > 0 ? (g.budgetTotal / g.estimasi) * 100 : null;
              const listingDenom = g.terstandarisasi + g.prosesStandar + g.gap;
              const estimasiAktifPengajuan = g.estimasi + g.estimasiAktif;
              const userCount = isOutlet ? g.userPsspAktifEstimasi : isProduk ? g.userPsspAktif : g.customer;
              const estimasiPerUser = userCount > 0 ? estimasiAktifPengajuan / userCount : null;
              const salesPerUser = userCount > 0 ? g.salesAktif / userCount : null;
              return (
                <tr key={g.code} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td className="py-2 px-3" style={{ color: "var(--color-text)" }}>
                    <p className="font-medium truncate max-w-[16rem]">{g.name}</p>
                    <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{g.code}</p>
                  </td>
                  {isProduk && (
                    <td className="py-2 px-3 whitespace-nowrap" style={{ color: g.variasiProdukFokus > 0 ? "var(--color-blue)" : "var(--color-text-muted)" }}>
                      {g.variasiProdukFokus > 0 ? "Fokus" : "Non-Fokus"}
                    </td>
                  )}
                  {!isProduk && (
                    <td className="py-2 px-3 whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{g.pic}</td>
                  )}
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    {isOutlet || isProduk ? (
                      <>
                        <div>{estimasiAktifPengajuan > 0 ? formatRp(estimasiAktifPengajuan) : "—"}</div>
                        {(g.estimasiAktif > 0 || g.estimasi > 0) && (
                          <div className="text-[10px] font-normal" style={{ color: "var(--color-text-faint)" }}>
                            Aktif {formatRp(g.estimasiAktif)} · Pengajuan {formatRp(g.estimasi)}
                          </div>
                        )}
                      </>
                    ) : (
                      g.estimasi > 0 ? formatRp(g.estimasi) : "—"
                    )}
                  </td>
                  {showRealisasi && (
                    <>
                      <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        {g.realisasi > 0 ? formatRp(g.realisasi) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap"
                        style={{ color: g.gapVsRealisasi > 0 ? "var(--color-danger, #dc2626)" : "var(--color-text-muted)" }}>
                        {g.gapVsRealisasi !== 0 ? formatRp(g.gapVsRealisasi) : "—"}
                      </td>
                    </>
                  )}
                  <td className="py-2 px-3 text-right" style={{ color: "var(--color-text)" }}>{userCount}</td>
                  {isOutlet && (
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                      {g.variasiProdukFokus}/{g.variasiProduk - g.variasiProdukFokus}
                    </td>
                  )}
                  {!isOutlet && !isProduk && (
                    <td className="py-2 px-3 text-right" style={{ color: "var(--color-text)" }}>{g.variasiProdukFokus}</td>
                  )}
                  <td className="py-2 px-3 text-right" style={{ color: "var(--color-text)" }}>{g.pengajuan}</td>
                  {(isOutlet || isProduk) && (
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                      {g.budgetTotal > 0 ? formatRp(g.budgetTotal) : "—"}
                    </td>
                  )}
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    {budgetPct != null ? `${budgetPct.toFixed(1)}%` : "—"}
                  </td>
                  {(isOutlet || isProduk) && (
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                      {g.salesAktif > 0 ? formatRp(g.salesAktif) : "—"}
                    </td>
                  )}
                  {isOutlet && (
                    <>
                      <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        {estimasiPerUser != null ? formatRp(estimasiPerUser) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        {g.listingFeeTotal > 0 ? formatRp(g.listingFeeTotal) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap"
                        style={{ color: g.pelunasanRunningRate == null ? "var(--color-text-faint)"
                          : g.pelunasanRunningRate >= 100 ? "var(--color-success, #16a34a)"
                          : g.pelunasanRunningRate >= 70 ? "var(--color-warning, #f59e0b)"
                          : "var(--color-red)" }}>
                        {g.pelunasanRunningRate != null ? `${g.pelunasanRunningRate.toFixed(1)}%` : "—"}
                      </td>
                    </>
                  )}
                  {isProduk && (
                    <>
                      <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        {salesPerUser != null ? formatRp(salesPerUser) : "—"}
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
                      {listingDenom > 0 ? `${g.terstandarisasi}/${listingDenom}` : "—"}
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
