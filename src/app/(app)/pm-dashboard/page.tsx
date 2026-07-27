import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips } from "@/lib/authz";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { spesLabel } from "@/lib/spesialisasi";

export const metadata = { title: "PM Dashboard · Form POA" };

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(2).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `Rp${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

interface ProductRow {
  nsmName: string;
  nsmNip: string;
  namaProduk: string;
  kodeProduk: string;
  kategori: string;
  estimasiSales: number;
  sudahStandarisasi: number;
  prosesStandarisasi: number;
  belumStandarisasi: number;
  jumlahSpesialisasi: number;
  jumlahPSSP: number;
}

export default async function PmDashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (!["NSM", "ADMIN"].includes(session.role)) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

  // Get all MRs visible to this user
  const mrNips = await getSubordinateMRNips(actor);

  // Fetch all approved line items from those MRs
  const lineItems = await prisma.poaLineItem.findMany({
    where: {
      poa: {
        ownerId: { in: mrNips.length > 0 ? mrNips : [actor.nip] },
        status: { in: ["APPROVED_BY_ASM", "APPROVED_BY_SM", "SUBMITTED_TO_NSM", "APPROVED_BY_NSM"] },
      },
    },
    select: {
      namaProduk: true,
      kodeProduk: true,
      kategoriProdukFokus: true,
      spesialisasi: true,
      statusStandarisasi: true,
      rencanaTotalBiaya: true,
      poa: { select: { owner: { select: { nip: true, name: true, nipAtasan: true } } } },
    },
  });

  // For each MR, traverse up to find their NSM
  // Since we're already filtering to subordinates, use actor as the NSM
  const nsmName = actor.name;
  const nsmNip  = actor.nip;

  // Aggregate by kodeProduk
  const produkMap = new Map<string, ProductRow>();

  for (const li of lineItems) {
    const key = `${nsmNip}::${li.kodeProduk}`;
    if (!produkMap.has(key)) {
      produkMap.set(key, {
        nsmName, nsmNip,
        namaProduk: li.namaProduk,
        kodeProduk: li.kodeProduk,
        kategori: li.kategoriProdukFokus,
        estimasiSales: 0,
        sudahStandarisasi: 0,
        prosesStandarisasi: 0,
        belumStandarisasi: 0,
        jumlahSpesialisasi: 0,
        jumlahPSSP: 0,
      });
    }
    const row = produkMap.get(key)!;
    row.estimasiSales += parseFloat(li.rencanaTotalBiaya.toString());
    if (li.statusStandarisasi === "SUDAH_STANDARISASI") row.sudahStandarisasi++;
    else if (li.statusStandarisasi === "PROSES_PENGAJUAN") row.prosesStandarisasi++;
    else if (li.statusStandarisasi === "BELUM_STANDARISASI") row.belumStandarisasi++;
    row.jumlahPSSP++;
  }

  // Count distinct spesialisasi per product
  const spesPerProduk = new Map<string, Set<string>>();
  for (const li of lineItems) {
    const key = `${nsmNip}::${li.kodeProduk}`;
    if (!spesPerProduk.has(key)) spesPerProduk.set(key, new Set());
    spesPerProduk.get(key)!.add(li.spesialisasi ?? "");
  }
  for (const [key, spes] of spesPerProduk) {
    const row = produkMap.get(key);
    if (row) row.jumlahSpesialisasi = spes.size;
  }

  const rows = Array.from(produkMap.values()).sort((a, b) => b.estimasiSales - a.estimasiSales);

  const totalEstimasi = rows.reduce((s, r) => s + r.estimasiSales, 0);
  const totalPSSP     = rows.reduce((s, r) => s + r.jumlahPSSP, 0);
  const totalSudah    = rows.reduce((s, r) => s + r.sudahStandarisasi, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1>PM Dashboard</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Ringkasan POA per produk · {nsmName}
        </p>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Estimasi", value: formatRp(totalEstimasi) },
          { label: "Total PSSP", value: String(totalPSSP) },
          { label: "Sudah Standarisasi", value: String(totalSudah) },
        ].map(({ label, value }) => (
          <Card key={label}>
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>{label}</p>
            <p className="mt-1 text-xl font-bold" style={{ color: "var(--color-text)" }}>{value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rekap per Produk</CardTitle>
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>{rows.length} produk</span>
        </CardHeader>

        {rows.length === 0 ? (
          <p className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>
            Belum ada POA yang disetujui.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {[
                    "Nama NSM", "Produk", "Kategori",
                    "Estimasi Sales", "Target*",
                    "Ratio Est/Target*",
                    "Sudah Std", "Proses Std", "Belum Std",
                    "Jml Spesialisasi", "Jml PSSP",
                  ].map((h) => (
                    <th key={h}
                      className="pb-3 px-2 text-left text-xs font-medium whitespace-nowrap"
                      style={{ color: "var(--color-text-faint)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {rows.map((row) => (
                  <tr key={row.kodeProduk}>
                    <td className="py-2.5 px-2 text-xs" style={{ color: "var(--color-text-muted)" }}>{row.nsmName}</td>
                    <td className="py-2.5 px-2">
                      <p className="font-medium text-xs" style={{ color: "var(--color-text)" }}>{row.namaProduk}</p>
                      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{row.kodeProduk}</p>
                    </td>
                    <td className="py-2.5 px-2 text-xs" style={{ color: "var(--color-text-muted)" }}>{row.kategori}</td>
                    <td className="py-2.5 px-2 text-xs font-medium text-right" style={{ color: "var(--color-text)" }}>
                      {formatRp(row.estimasiSales)}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-center" style={{ color: "var(--color-text-faint)" }}>-</td>
                    <td className="py-2.5 px-2 text-xs text-center" style={{ color: "var(--color-text-faint)" }}>-</td>
                    <td className="py-2.5 px-2 text-xs text-center font-medium"
                      style={{ color: row.sudahStandarisasi > 0 ? "var(--color-success, #16a34a)" : "var(--color-text-faint)" }}>
                      {row.sudahStandarisasi || "-"}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
                      {row.prosesStandarisasi || "-"}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
                      {row.belumStandarisasi || "-"}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
                      {row.jumlahSpesialisasi}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-center font-medium" style={{ color: "var(--color-text)" }}>
                      {row.jumlahPSSP}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs" style={{ color: "var(--color-text-faint)" }}>
          * Target belum tersedia - akan diisi setelah data target area tersedia.
        </p>
      </Card>
    </div>
  );
}
