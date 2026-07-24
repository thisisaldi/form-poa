import type { MonitoringGroup } from "@/components/poa/MonitoringChecklist";
import { Card } from "@/components/ui/Card";

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `Rp ${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

/**
 * Per-row breakdown behind whichever tab is active on /summary (Region, Area,
 * Sub Area, GT, Outlet, or Per MR) — MonitoringChecklist above only shows the
 * grand total, so without this table switching tabs had no visible effect
 * (2026-07-23: the whole point of "bisa lihat per outlet, per personil" is
 * seeing the individual rows, not just one aggregate card).
 */
export function TerritoryTable({ groups, codeLabel, showRealisasi = false }: { groups: MonitoringGroup[]; codeLabel: string; showRealisasi?: boolean }) {
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
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>{codeLabel}</th>
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>PIC</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Estimasi</th>
              {showRealisasi && (
                <>
                  <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Realisasi Sebelumnya</th>
                  <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Gap</th>
                </>
              )}
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Customer</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Produk Fokus</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Pengajuan</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>% Budget</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Listing</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const budgetPct = g.estimasi > 0 ? (g.budgetTotal / g.estimasi) * 100 : null;
              const listingDenom = g.terstandarisasi + g.prosesStandar + g.gap;
              return (
                <tr key={g.code} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td className="py-2 px-3" style={{ color: "var(--color-text)" }}>
                    <p className="font-medium truncate max-w-[16rem]">{g.name}</p>
                    <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{g.code}</p>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{g.pic}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    {g.estimasi > 0 ? formatRp(g.estimasi) : "—"}
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
                  <td className="py-2 px-3 text-right" style={{ color: "var(--color-text)" }}>{g.customer}</td>
                  <td className="py-2 px-3 text-right" style={{ color: "var(--color-text)" }}>{g.variasiProdukFokus}</td>
                  <td className="py-2 px-3 text-right" style={{ color: "var(--color-text)" }}>{g.pengajuan}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    {budgetPct != null ? `${budgetPct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                    {listingDenom > 0 ? `${g.terstandarisasi}/${listingDenom}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
