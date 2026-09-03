import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getPendingActionScFilter } from "@/lib/authz";
import { displayRole } from "@/lib/role";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SalesCounterApprovalsChecklist, type MrApprovalGroup } from "@/components/sc/SalesCounterApprovalsChecklist";
import { getSalesCounterProduct } from "../[id]/_services/getSalesCounterProduct";
import { getBlastInOutletSet } from "@/lib/outletBlastIn";
import { getSalesCounterOutletsDirect } from "@/lib/masterData";
import type { ScDraftFormItem } from "@/components/sc/types";
import type { PoaStatus } from "@prisma/client";

export const metadata = { title: "Persetujuan Sales Counter · Form POA" };

export default async function SalesCounterApprovalsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const actor = await prisma.user.findUnique({
    where: { nip: session.userId },
  });

  if (!actor || !["ASM", "SM", "NSM", "ADMIN"].includes(actor.role)) {
    redirect("/sc/dashboard");
  }

  const pendingFilter = getPendingActionScFilter(actor);

  const pendingForms = await prisma.poaScForm.findMany({
    where: pendingFilter,
    include: {
      owner: true,
      products: true,
      persons: true,
      entertainItems: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // Collect unique product codes & outlet codes across all pending forms
  const allProductCodes = Array.from(
    new Set(pendingForms.flatMap((f: any) => f.products.map((p: any) => p.kodeProduk)).filter(Boolean))
  );

  const outletCodes = Array.from(new Set(pendingForms.map((f: any) => f.kodePI).filter(Boolean))) as string[];
  const canvasserProductMap = new Map<string, { sales_counter_value: number; sales_counter_minimum: number }>();

  const [masterProducts, blastInSet, rawOutlets] = await Promise.all([
    allProductCodes.length > 0
      ? prisma.product.findMany({
          where: { kodeProduk: { in: allProductCodes } },
          select: {
            kodeProduk: true,
            namaProduk: true,
            hna: true,
            konversiPembagi: true,
            satuanTerkecil: true,
            satuan: true,
          },
        })
      : [],
    getBlastInOutletSet().catch(() => new Set<string>()),
    getSalesCounterOutletsDirect(actor.nip).catch(() => []),
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

  const masterProductMap = new Map<string, any>(
    masterProducts.map((p: any) => [p.kodeProduk, p])
  );
  const outletScMap = new Map(rawOutlets.map((o: any) => [o.kodePI, !!o.is_sc]));

  // Build serialized ScDraftFormItem list
  const scDrafts: ScDraftFormItem[] = pendingForms.map((d: any) => ({
    id: d.id,
    period: d.period,
    periodeAwal: d.periodeAwal,
    lamaPeriode: d.lamaPeriode,
    status: d.status,
    version: d.version,
    kodePI: d.kodePI,
    namaOutlet: d.namaOutlet || `Outlet ${d.kodePI}`,
    persenResepDokter: d.persenResepDokter,
    jumlahKaryawan: (d.jumlahKaryawan && d.jumlahKaryawan > 0) ? d.jumlahKaryawan : (rawOutlets.find((o: any) => o.kodePI === d.kodePI)?.jumlah_karyawan ?? d.jumlahKaryawan ?? null),
    jumlahPasien: (d.jumlahPasien && d.jumlahPasien > 0) ? d.jumlahPasien : (rawOutlets.find((o: any) => o.kodePI === d.kodePI)?.jumlah_pasien ?? d.jumlahPasien ?? null),
    jumlahPasienResep: (d.jumlahPasienResep && d.jumlahPasienResep > 0) ? d.jumlahPasienResep : (rawOutlets.find((o: any) => o.kodePI === d.kodePI)?.jumlah_pasien_resep ?? d.jumlahPasienResep ?? null),
    jumlahPasienNonResep: (d.jumlahPasienNonResep && d.jumlahPasienNonResep > 0) ? d.jumlahPasienNonResep : (rawOutlets.find((o: any) => o.kodePI === d.kodePI)?.jumlah_pasien_non_resep ?? d.jumlahPasienNonResep ?? null),
    ownerId: d.ownerId,
    is_sc: outletScMap.get(d.kodePI) ?? false,
    isBlastIn: blastInSet.has(d.kodePI),
    persons: d.persons.map((p: any) => ({
      id: p.id,
      nik_ktp: p.nik_ktp,
      personName: p.personName,
      positionName: p.positionName,
    })),
    products: d.products.map((p: any) => {
      const mp = masterProductMap.get(p.kodeProduk);
      const cp = canvasserProductMap.get(`${d.kodePI}_${p.kodeProduk}`);
      return {
        id: p.id,
        kodeProduk: p.kodeProduk,
        namaProduk: p.namaProduk,
        produkKompetitor: p.produkKompetitor || null,
        qtyPerBulan: p.qtyPerBulan,
        persenMatriksSc: Number(p.persenMatriksSc.toString()),
        persenDiskon: Number(p.persenDiskon.toString()),
        persenCashback: Number(p.persenCashback.toString()),
        rencanaTotalBiaya: Number(p.rencanaTotalBiaya.toString()),
        hnaSJ: mp ? Number(mp.hna.toString()) : 0,
        konversiPembagi: mp?.konversiPembagi ? Number(mp.konversiPembagi.toString()) : 1,
        satuanTerkecil: mp?.satuanTerkecil || "ST",
        satuanSJ: mp?.satuan || "SJ",
        salesCounterValue: cp?.sales_counter_value || 0,
        salesCounterMinimum: cp?.sales_counter_minimum || 0,
      };
    }),
    entertainItems: d.entertainItems.map((e: any) => ({
      id: e.id,
      periodeMonth: e.periodeMonth,
      biayaEntertain: Number(e.biayaEntertain.toString()),
    })),
  }));

  // Group forms by owner (MR) & period for manager review
  const groupedMap = new Map<string, { owner: any; period: string; forms: any[] }>();

  for (const form of pendingForms) {
    const key = `${form.period}_${form.ownerId}`;
    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        owner: form.owner,
        period: form.period,
        forms: [],
      });
    }
    groupedMap.get(key)!.forms.push(form);
  }

  // Query all forms for these owner+period pairs to calculate approvedCount & belumCount
  const ownerPeriodPairs = Array.from(groupedMap.values()).map((g) => ({
    ownerId: g.owner.nip,
    period: g.period,
  }));

  const allFormsForGroups = ownerPeriodPairs.length > 0
    ? await prisma.poaScForm.findMany({
        where: {
          OR: ownerPeriodPairs.map((p) => ({ ownerId: p.ownerId, period: p.period })),
          status: { not: "DRAFT" as PoaStatus },
        },
        select: { id: true, ownerId: true, period: true, status: true },
      })
    : [];

  const mrGroups: MrApprovalGroup[] = Array.from(groupedMap.values()).map((g) => {
    const allInPeriod = (allFormsForGroups as { id: string; ownerId: string; period: string; status: string }[]).filter(
      (f) => f.ownerId === g.owner.nip && f.period === g.period
    );
    const approvedCount = allInPeriod.filter((f) => f.status === "APPROVED_BY_NSM").length;
    const belumCount = allInPeriod.length - approvedCount;

    const totalBudgetSc = g.forms.reduce((sum: number, f: any) => {
      const prodSum = f.products.reduce((ps: number, p: any) => ps + Number(p.rencanaTotalBiaya.toString()), 0);
      const entSum = f.entertainItems.reduce((es: number, e: any) => es + Number(e.biayaEntertain.toString()), 0);
      return sum + prodSum + entSum;
    }, 0);

    return {
      ownerNip: g.owner.nip,
      ownerName: g.owner.name,
      period: g.period,
      status: (g.forms[0]?.status as PoaStatus) || "SUBMITTED_TO_ASM",
      version: g.forms[0]?.version || 1,
      outletCount: g.forms.length,
      approvedCount,
      belumCount,
      totalBudgetSc,
      targetHref: `/sc/${g.forms[0]?.id || g.period}`,
      forms: g.forms.map((f) => ({
        id: f.id,
        kodePI: f.kodePI,
        namaOutlet: f.namaOutlet,
        status: f.status,
        version: f.version,
      })),
    };
  });

  const dominantPeriod = pendingForms[0]?.period || "";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Persetujuan Sales Counter</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          POA Sales Counter yang menunggu tindakan Anda sebagai {displayRole(actor.role, actor.jabatan)}
        </p>
      </div>

      {pendingForms.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Tidak ada pengajuan Sales Counter yang menunggu persetujuan Anda saat ini.
            </p>
            <Link href="/sc/dashboard" className="mt-3 inline-block">
              <Button variant="ghost" size="sm">
                Kembali ke Dashboard
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <SalesCounterApprovalsChecklist
          mrGroups={mrGroups}
          scDrafts={scDrafts}
          dominantPeriod={dominantPeriod}
        />
      )}
    </div>
  );
}
