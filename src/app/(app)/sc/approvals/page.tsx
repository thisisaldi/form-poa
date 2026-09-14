import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getPendingActionScFilter } from "@/lib/authz";
import { displayRole } from "@/lib/role";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SalesCounterApprovalsChecklist, type MrApprovalGroup } from "@/components/sc/SalesCounterApprovalsChecklist";
import { ScToastProvider } from "@/components/sc/ui/ScToast";
import { getSalesCounterProduct } from "../[id]/_services/getSalesCounterProduct";
import { getBlastInOutletSet } from "@/lib/outletBlastIn";
import { getSalesCounterOutletsDirect } from "@/lib/masterData";
import type { ScDraftFormItem } from "@/components/sc/types";
import { Role, Prisma, type PoaStatus } from "@prisma/client";

export const metadata = { title: "Persetujuan Sales Counter · Form POA" };

interface UserHierarchyNode {
  nip: string;
  name: string;
  role: Role;
  reportsTo?: {
    nip: string;
    name: string;
    role: Role;
    reportsTo?: {
      nip: string;
      name: string;
      role: Role;
    } | null;
  } | null;
}

function resolveAsm(owner: UserHierarchyNode): { nip: string; name: string } | null {
  if (owner.role === "ASM") return { nip: owner.nip, name: owner.name };
  if (owner.reportsTo?.role === "ASM") return { nip: owner.reportsTo.nip, name: owner.reportsTo.name };
  if (owner.reportsTo?.reportsTo?.role === "ASM") return { nip: owner.reportsTo.reportsTo.nip, name: owner.reportsTo.reportsTo.name };
  if (owner.reportsTo) return { nip: owner.reportsTo.nip, name: owner.reportsTo.name };
  return null;
}

type PendingPoaScWithIncludes = Prisma.PoaScFormGetPayload<{
  include: {
    owner: {
      include: {
        reportsTo: {
          include: {
            reportsTo: true;
          };
        };
      };
    };
    products: true;
    persons: true;
    entertainItems: true;
  };
}>;

type MasterProductItem = {
  kodeProduk: string;
  namaProduk: string;
  hna: Prisma.Decimal;
  konversiPembagi: Prisma.Decimal | null;
  satuanTerkecil: string | null;
  satuan: string | null;
};

export default async function SalesCounterApprovalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const actor = await prisma.user.findUnique({
    where: { nip: session.userId },
  });

  if (!actor || !["ASM", "SM", "NSM", "ADMIN"].includes(actor.role)) {
    redirect("/sc/dashboard");
  }

  const pendingFilter = getPendingActionScFilter(actor);

  // Collect distinct available periods for filter
  const allPendingPeriods = await prisma.poaScForm.findMany({
    where: pendingFilter,
    select: { period: true },
    distinct: ["period"],
    orderBy: { period: "desc" },
  });
  const availablePeriods = allPendingPeriods.map((p: { period: string }) => p.period);

  const params = searchParams ? await searchParams : {};
  const selectedPeriod = params?.period && availablePeriods.includes(params.period)
    ? params.period
    : "ALL";

  const effectiveFilter = selectedPeriod !== "ALL"
    ? { ...pendingFilter, period: selectedPeriod }
    : pendingFilter;

  const pendingForms: PendingPoaScWithIncludes[] = await prisma.poaScForm.findMany({
    where: effectiveFilter,
    include: {
      owner: {
        include: {
          reportsTo: {
            include: {
              reportsTo: true,
            },
          },
        },
      },
      products: true,
      persons: true,
      entertainItems: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // Collect unique product codes & outlet codes across all pending forms
  const allProductCodes = Array.from(
    new Set(pendingForms.flatMap((f: PendingPoaScWithIncludes) => f.products.map((p: PendingPoaScWithIncludes["products"][number]) => p.kodeProduk)).filter(Boolean))
  );

  const outletCodes = Array.from(new Set(pendingForms.map((f: PendingPoaScWithIncludes) => f.kodePI).filter(Boolean))) as string[];
  const canvasserProductMap = new Map<string, { sales_counter_value: number; sales_counter_minimum: number }>();

  const [masterProducts, blastInSet, rawOutlets] = await Promise.all([
    allProductCodes.length > 0
      ? (prisma.product.findMany({
          where: { kodeProduk: { in: allProductCodes } },
          select: {
            kodeProduk: true,
            namaProduk: true,
            hna: true,
            konversiPembagi: true,
            satuanTerkecil: true,
            satuan: true,
          },
        }) as Promise<MasterProductItem[]>)
      : Promise.resolve([] as MasterProductItem[]),
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

  const masterProductMap = new Map<string, MasterProductItem>(
    masterProducts.map((p: MasterProductItem) => [p.kodeProduk, p])
  );
  const outletScMap = new Map(rawOutlets.map((o) => [o.kodePI, !!o.is_sc]));

  type RawOutlet = (typeof rawOutlets)[number];
  type ScPerson = PendingPoaScWithIncludes["persons"][number];
  type ScProduct = PendingPoaScWithIncludes["products"][number];
  type ScEntertain = PendingPoaScWithIncludes["entertainItems"][number];

  // Build serialized ScDraftFormItem list for stats panel
  const scDrafts: ScDraftFormItem[] = pendingForms.map((d: PendingPoaScWithIncludes) => {
    const matchedOutlet = rawOutlets.find((o: RawOutlet) => o.kodePI === d.kodePI);
    return {
      id: d.id,
      period: d.period,
      periodeAwal: d.periodeAwal,
      lamaPeriode: d.lamaPeriode,
      status: d.status,
      version: d.version,
      kodePI: d.kodePI,
      namaOutlet: d.namaOutlet || `Outlet ${d.kodePI}`,
      persenResepDokter: d.persenResepDokter,
      jumlahKaryawan: (d.jumlahKaryawan && d.jumlahKaryawan > 0) ? d.jumlahKaryawan : (matchedOutlet?.jumlah_karyawan ?? d.jumlahKaryawan ?? null),
      jumlahPasien: (d.jumlahPasien && d.jumlahPasien > 0) ? d.jumlahPasien : (matchedOutlet?.jumlah_pasien ?? d.jumlahPasien ?? null),
      jumlahPasienResep: (d.jumlahPasienResep && d.jumlahPasienResep > 0) ? d.jumlahPasienResep : (matchedOutlet?.jumlah_pasien_resep ?? d.jumlahPasienResep ?? null),
      jumlahPasienNonResep: (d.jumlahPasienNonResep && d.jumlahPasienNonResep > 0) ? d.jumlahPasienNonResep : (matchedOutlet?.jumlah_pasien_non_resep ?? d.jumlahPasienNonResep ?? null),
      ownerId: d.ownerId,
      is_sc: outletScMap.get(d.kodePI) ?? false,
      isBlastIn: blastInSet.has(d.kodePI),
      persons: d.persons.map((p: ScPerson) => ({
        id: p.id,
        outletPersonId: p.outletPersonId,
        nik_ktp: p.outletPersonId,
        personName: p.personName,
        positionName: p.positionName,
      })),
      products: d.products.map((p: ScProduct) => {
        const mp = masterProductMap.get(p.kodeProduk);
        const cp = canvasserProductMap.get(`${d.kodePI}_${p.kodeProduk}`);
        return {
          id: p.id,
          kodeProduk: p.kodeProduk,
          namaProduk: p.namaProduk,
          periodeMonth: p.periodeMonth,
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
      entertainItems: d.entertainItems.map((e: ScEntertain) => ({
        id: e.id,
        periodeMonth: e.periodeMonth,
        biayaEntertain: Number(e.biayaEntertain.toString()),
      })),
    };
  });

  // Group forms:
  // - If NSM: group by ASM
  // - If SM / ASM / ADMIN: group by MR
  const isNSM = actor.role === "NSM";

  type PendingForm = (typeof pendingForms)[number];

  type GroupBucket = {
    groupKey: string;
    groupType: "MR" | "ASM";
    nip: string;
    name: string;
    period: string;
    asmName: string | null;
    ownerNips: string[];
    forms: PendingForm[];
  };

  const groupedMap = new Map<string, GroupBucket>();

  for (const form of pendingForms) {
    const asm = resolveAsm(form.owner);
    let key: string;
    let groupType: "MR" | "ASM";
    let nip: string;
    let name: string;
    const asmName: string | null = asm?.name || null;

    if (isNSM) {
      groupType = "ASM";
      nip = asm?.nip || form.owner.nip;
      name = asm?.name || form.owner.name;
      key = `${form.period}_${nip}`;
    } else {
      groupType = "MR";
      nip = form.owner.nip;
      name = form.owner.name;
      key = `${form.period}_${form.ownerId}`;
    }

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupKey: key,
        groupType,
        nip,
        name,
        period: form.period,
        asmName,
        ownerNips: [],
        forms: [],
      });
    }

    const bucket = groupedMap.get(key)!;
    bucket.forms.push(form);
    if (!bucket.ownerNips.includes(form.ownerId)) {
      bucket.ownerNips.push(form.ownerId);
    }
  }


  // Query all non-draft forms for these owner+period pairs to calculate approvedCount & belumCount
  const allOwnerNips = Array.from(new Set(Array.from(groupedMap.values()).flatMap((g) => g.ownerNips)));
  const allPeriods = Array.from(new Set(Array.from(groupedMap.values()).map((g) => g.period)));

  const allFormsForGroups = allOwnerNips.length > 0 && allPeriods.length > 0
    ? await prisma.poaScForm.findMany({
        where: {
          ownerId: { in: allOwnerNips },
          period: { in: allPeriods },
          status: { not: "DRAFT" as PoaStatus },
        },
        select: { id: true, ownerId: true, period: true, status: true },
      })
    : [];

  let defaultBadgeLabel = "Butuh Tindakan";
  if (actor.role === "ASM") defaultBadgeLabel = "Butuh Approval ASM";
  else if (actor.role === "SM") defaultBadgeLabel = "Butuh Approval SM";
  else if (actor.role === "NSM") defaultBadgeLabel = "Butuh Approval NSM";

  const mrGroups: MrApprovalGroup[] = Array.from(groupedMap.values()).map((g) => {
    const matchingForms = (allFormsForGroups as { id: string; ownerId: string; period: string; status: string }[]).filter(
      (f) => g.ownerNips.includes(f.ownerId) && f.period === g.period
    );
    const approvedCount = matchingForms.filter((f) => f.status === "APPROVED_BY_NSM").length;
    const belumCount = matchingForms.length - approvedCount;

    let totalEstimasiSales = 0;
    let totalBudgetSc = 0;
    const distinctOutlets = new Set<string>();
    const distinctProducts = new Set<string>();

    for (const f of g.forms) {
      if (f.kodePI) distinctOutlets.add(f.kodePI);
      const lama = f.lamaPeriode || 3;
      const distinctProductMonths = new Set(f.products.map((p) => p.periodeMonth).filter(Boolean));
      const isMultiMonth = distinctProductMonths.size > 1;

      for (const p of f.products) {
        if (p.kodeProduk) distinctProducts.add(p.kodeProduk);
        const mp = masterProductMap.get(p.kodeProduk);
        const hna = mp ? Number(mp.hna.toString()) : 0;
        const qty = p.qtyPerBulan || 0;
        totalEstimasiSales += isMultiMonth ? (qty * hna) : (qty * hna * lama);
        totalBudgetSc += Number(p.rencanaTotalBiaya?.toString() || 0);
      }

      for (const e of f.entertainItems) {
        totalBudgetSc += Number(e.biayaEntertain?.toString() || 0);
      }
    }

    const targetValue = null;
    const targetRatio = null;

    return {
      groupKey: g.groupKey,
      groupType: g.groupType,
      ownerNip: g.nip,
      ownerName: g.name,
      period: g.period,
      status: (g.forms[0]?.status as PoaStatus) || "SUBMITTED_TO_ASM",
      version: g.forms[0]?.version || 1,
      badgeLabel: defaultBadgeLabel,
      asmName: g.groupType === "MR" ? g.asmName : null,
      mrCount: g.groupType === "ASM" ? g.ownerNips.length : undefined,
      totalEstimasiSales,
      outletCount: distinctOutlets.size,
      variasiProdukCount: distinctProducts.size,
      targetValue,
      targetRatio,
      approvedCount,
      belumCount,
      totalBudgetSc,
      targetHref: `/sc/${g.forms[0]?.id || g.period}`,
      forms: g.forms.map((f) => ({
        id: f.id,
        kodePI: f.kodePI,
        namaOutlet: f.namaOutlet || "",
        status: f.status,
        version: f.version,
      })),
    };
  });

  const dominantPeriod = selectedPeriod !== "ALL" ? selectedPeriod : (pendingForms[0]?.period || "");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Persetujuan Sales Counter</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          POA Sales Counter yang menunggu tindakan Anda sebagai {displayRole(actor.role, actor.jabatan)}
        </p>
      </div>

      {pendingForms.length === 0 && availablePeriods.length === 0 ? (
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
        <ScToastProvider>
          <SalesCounterApprovalsChecklist
            mrGroups={mrGroups}
            scDrafts={scDrafts}
            dominantPeriod={dominantPeriod}
            userRole={actor.role}
            availablePeriods={availablePeriods}
            selectedPeriod={selectedPeriod}
          />
        </ScToastProvider>
      )}
    </div>
  );
}
