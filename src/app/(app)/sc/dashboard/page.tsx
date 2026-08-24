import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { NotReadyButton } from "@/components/ui/NotReadyButton";
import { DeletePoaScButton } from "@/components/sc/DeletePoaScButton";
import { formatCurrency as formatRp } from "@/lib/format";
import type { PoaStatus } from "@prisma/client";
import { getScCashbackPoa } from "../[id]/_services/getScCashbackPoa";
import { getSalesCounterProduct } from "../[id]/_services/getSalesCounterProduct";
import { calculateCashbackDetails } from "@/components/sc/edit/hooks/useSalesCounterCashback";

export const metadata = { title: "Dashboard POA Sales Counter · Form POA" };

export default async function SalesCounterDashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

  // Fetch all Sales Counter forms owned by this MR
  const scForms = await prisma.poaScForm.findMany({
    where: { ownerId: session.userId },
    include: {
      owner: true,
      products: true,
      entertainItems: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // Collect all product codes across forms to fetch master product HNA
  const allProductCodes = Array.from(
    new Set(scForms.flatMap((f: any) => f.products.map((p: any) => p.kodeProduk)).filter(Boolean))
  );

  const masterProducts = allProductCodes.length > 0
    ? await prisma.product.findMany({
        where: { kodeProduk: { in: allProductCodes } },
        select: { kodeProduk: true, hna: true, konversiPembagi: true },
      })
    : [];

  const masterProductMap = new Map<string, any>(
    masterProducts.map((p: any) => [p.kodeProduk, p])
  );

  const outletCodes = Array.from(new Set(scForms.map((f: any) => f.kodePI).filter(Boolean))) as string[];
  const canvasserProductMap = new Map<string, { sales_counter_value: number; sales_counter_minimum: number }>();

  const [cashbackData] = await Promise.all([
    getScCashbackPoa(),
    Promise.all(
      outletCodes.map(async (kodePI: string) => {
        try {
          const res = await getSalesCounterProduct(kodePI);
          if (res?.data) {
            for (const cp of res.data) {
              canvasserProductMap.set(`${kodePI}_${cp.pro_code}`, {
                sales_counter_value: cp.sales_counter_value || 0,
                sales_counter_minimum: cp.sales_counter_minimum || 0,
              });
            }
          }
        } catch (err) {
          console.error(`Error fetching SC products for ${kodePI}:`, err);
        }
      })
    ),
  ]);

  // Group forms by period
  const periodsMap = new Map<string, {
    period: string;
    status: PoaStatus;
    version: number;
    owner: typeof actor;
    _totalEstSales: number;
    _totalBudgetSc: number;
    _outletCount: number;
    updatedAt: Date;
  }>();

  for (const f of scForms) {
    const lama = f.lamaPeriode || 3;

    const cbDetails = calculateCashbackDetails({
      cashbackData,
      selectedProducts: f.products.map((p: any) => ({
        kodeProduk: p.kodeProduk,
        qtyPerBulan: String(p.qtyPerBulan || 0),
        persenCashback: String(p.persenCashback || 0),
      })),
      masterProducts: f.products.map((p: any) => {
        const mp = masterProductMap.get(p.kodeProduk);
        return {
          kodeProduk: p.kodeProduk,
          hna: String(mp ? Number(mp.hna.toString()) : 0),
          konversiPembagi: String(mp?.konversiPembagi ? Number(mp.konversiPembagi.toString()) : 1),
        };
      }),
      lamaPeriode: lama,
    });

    let fEstSales = 0;
    let fBudgetSc = 0;

    for (const p of f.products) {
      if (!p.kodeProduk) continue;
      const mp = masterProductMap.get(p.kodeProduk);
      const cp = canvasserProductMap.get(`${f.kodePI}_${p.kodeProduk}`);
      const hnaSJ = mp ? Number(mp.hna.toString()) : 0;
      const konv = mp?.konversiPembagi ? Number(mp.konversiPembagi.toString()) : 1;
      const hnaST = hnaSJ / konv;

      const qty = p.qtyPerBulan || 0;

      const estSalesPerMonth = qty * hnaST;
      const estSalesFull = estSalesPerMonth * lama;

      const qtySjBln = konv > 0 ? qty / konv : 0;
      const scVal = cp?.sales_counter_value;
      const scMin = cp?.sales_counter_minimum || 0;

      let nilaiScPerMonth = 0;
      if (scVal != null && scVal > 0) {
        nilaiScPerMonth = qtySjBln >= scMin ? qtySjBln * scVal : 0;
      } else {
        const pctMatriks = Number(p.persenMatriksSc?.toString() || 0);
        nilaiScPerMonth = estSalesPerMonth * (pctMatriks / 100);
      }
      const nilaiScFull = nilaiScPerMonth * lama;

      const diskonFull = estSalesFull * (Number(p.persenDiskon?.toString() || 0) / 100);
      const cashbackFull = cashbackData
        ? (cbDetails.resultMap.get(p.kodeProduk) ?? 0)
        : estSalesFull * (Number(p.persenCashback?.toString() || 0) / 100);

      fEstSales += estSalesFull;
      fBudgetSc += nilaiScFull + diskonFull + cashbackFull;
    }

    const totalEnt = f.entertainItems.reduce(
      (sum: number, e: any) => sum + Number(e.biayaEntertain?.toString() || 0),
      0
    );
    fBudgetSc += totalEnt;

    const existing = periodsMap.get(f.period);
    if (existing) {
      existing._totalEstSales += fEstSales;
      existing._totalBudgetSc += fBudgetSc;
      existing._outletCount += 1;
      if (f.updatedAt > existing.updatedAt) {
        existing.updatedAt = f.updatedAt;
      }
      if (f.status === "DRAFT" || (f.status === "SUBMITTED_TO_ASM" && existing.status !== "DRAFT")) {
        existing.status = f.status;
      }
    } else {
      periodsMap.set(f.period, {
        period: f.period,
        status: f.status,
        version: f.version,
        owner: f.owner,
        _totalEstSales: fEstSales,
        _totalBudgetSc: fBudgetSc,
        _outletCount: 1,
        updatedAt: f.updatedAt,
      });
    }
  }

  const recentPeriods = [...periodsMap.values()].sort((a, b) => b.period.localeCompare(a.period));

  return (
    <div className="space-y-6">
      {/* Header — static, renders immediately */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p style={{ color: "var(--color-text-muted)" }} className="mt-0.5 text-sm">
          Selamat datang, <span className="font-semibold uppercase">{actor.name}</span>
          <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-medium"
            style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
            MR
          </span>
        </p>
      </div>

      {/* Action Buttons Row */}
      <div className="flex items-center justify-end gap-2">
        <NotReadyButton label="+ Daftar User Baru" message="Fitur Daftar Dokter Baru masih dalam pengembangan." />
        <Link href="/sc/new">
          <Button>+ Buat POA Baru</Button>
        </Link>
      </div>

      {/* Main Period Draft List */}
      <Card>
        <CardHeader>
          <CardTitle>POA Saya</CardTitle>
        </CardHeader>

        {recentPeriods.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Belum ada POA. Buat POA pertama Anda.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto p-5 pt-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: "var(--color-border)" }}>
                  <th className="pb-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>MR</th>
                  <th className="pb-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Period</th>
                  <th className="pb-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Status</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Target</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Estimasi</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Ratio %</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {recentPeriods.map((p) => {
                  const isDraft = p.status === "DRAFT";
                  const isRevisi = p.status === "REVISI";
                  const ratioPct = p._totalEstSales > 0 ? (p._totalBudgetSc / p._totalEstSales) * 100 : 0;
                  return (
                    <tr key={p.period} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/20">
                      <td className="py-3">
                        <p className="font-medium" style={{ color: "var(--color-text)" }}>{p.owner.name}</p>
                        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{p.owner.nip}</p>
                      </td>
                      <td className="py-3 font-medium" style={{ color: "var(--color-text)" }}>{p.period}</td>
                      <td className="py-3">
                        <StatusBadge status={p.status} version={p.version} />
                      </td>
                      <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                        -
                      </td>
                      <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text)" }}>
                        {p._totalEstSales > 0 ? formatRp(p._totalEstSales) : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                      </td>
                      <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text)" }}>
                        {ratioPct > 0 ? `${ratioPct.toFixed(2)}%` : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {(isDraft || isRevisi) && (
                            <Link href={`/sc/${p.period}/edit`} className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                              Tambah
                            </Link>
                          )}
                          <Link href={`/sc/${p.period}`} style={{ color: "var(--color-blue)" }} className="text-xs font-medium">
                            Detail
                          </Link>
                          {isDraft && (
                            <DeletePoaScButton period={p.period} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
