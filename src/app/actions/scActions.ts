"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isWriteBlocked, WRITE_BLOCKED_MESSAGE } from "@/lib/maintenance";
import { PoaStatus, AuditAction, DiskonDplDpf } from "@prisma/client";
import { getSalesCountersByOutlet } from "../(app)/sc/[id]/_services/getSalesCounters";
import { getSalesCounterOutletsDirect } from "@/lib/masterData";
import { canUserEditScForm } from "@/lib/authz";

async function requireSession() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) redirect("/dashboard?error=" + encodeURIComponent(WRITE_BLOCKED_MESSAGE));
  return session;
}

export async function saveSalesCounterFormAction(
  period: string,
  outletId: string,
  selectedPersonIds: number[],
  products: {
    kodeProduk: string;
    produkKompetitor: string;
    qtyPerBulan: string;
    persenMatriksSc: string;
    persenDiskon: string;
    persenCashback: string;
    rencanaTotalBiaya: number;
  }[],
  entertainList: {
    month: string;
    label: string;
    value: string;
  }[],
  persenResepDokter: number,
  namaOutletParam?: string,
  jumlahKaryawan?: number | null,
  jumlahPasien?: number | null,
  jumlahPasienResep?: number | null,
  jumlahPasienNonResep?: number | null,
  periodeAwalParam?: string,
  lamaPeriodeParam?: number,
  scIdParam?: string
): Promise<{ ok: boolean; error?: string; poaScId?: string }> {
  const session = await requireSession();

  // 1. Validation
  if (!period || !outletId) {
    return { ok: false, error: "Periode dan Outlet wajib diisi." };
  }
  if (selectedPersonIds.length === 0) {
    return { ok: false, error: "Minimal pilih 1 Sales Counter." };
  }
  const hasValidProduct = products.some((p) => p.kodeProduk && (parseFloat(p.qtyPerBulan) || 0) > 0);
  if (!hasValidProduct) {
    return { ok: false, error: "Minimal pilih 1 produk dengan kuantitas > 0." };
  }

  // 2. Fetch canvasser person names from canvasser API
  const canvasserRes = await getSalesCountersByOutlet(outletId);
  const canvasserData = canvasserRes?.data || [];

  const personItems = selectedPersonIds.map((pId) => {
    const detail = canvasserData.find((c: any) => c.person_id === pId);
    return {
      nik_ktp: String(pId),
      personName: detail?.person_name || `Sales Counter ${pId}`,
      positionName: detail?.position_name || "Sales Counter",
    };
  });

  // Calculate default periodeAwal (format YYYYMM) and duration
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return { ok: false, error: "Format periode tidak valid." };
  const year = m[1];
  const quarter = parseInt(m[2], 10);
  const defaultStartMonthNum = (quarter - 1) * 3 + 1;
  const defaultStartMonthStr = String(defaultStartMonthNum).padStart(2, "0");
  const defaultPeriodeAwal = `${year}${defaultStartMonthStr}`;
  const defaultLamaPeriode = 3;

  const periodeAwal =
    periodeAwalParam && /^\d{6}$/.test(periodeAwalParam)
      ? periodeAwalParam
      : defaultPeriodeAwal;

  let lamaPeriode = defaultLamaPeriode;
  if (typeof lamaPeriodeParam === "number" && lamaPeriodeParam > 0) {
    lamaPeriode = lamaPeriodeParam;
  } else {
    const startYear = parseInt(periodeAwal.slice(0, 4), 10);
    const startMonth = parseInt(periodeAwal.slice(4, 6), 10);
    const endMonth = quarter * 3;
    const calcDuration = (parseInt(year, 10) - startYear) * 12 + (endMonth - startMonth + 1);
    lamaPeriode = calcDuration > 0 ? calcDuration : defaultLamaPeriode;
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // 3. Query existing form with its relations
      let existing: any = null;
      if (scIdParam) {
        existing = await tx.poaScForm.findUnique({
          where: { id: scIdParam },
          include: {
            products: true,
            persons: true,
            entertainItems: true,
          },
        });
      }
      if (!existing) {
        existing = await tx.poaScForm.findFirst({
          where: { ownerId: session.userId, period, kodePI: outletId },
          include: {
            products: true,
            persons: true,
            entertainItems: true,
          },
        });
      }

      if (existing) {
        const canEdit = canUserEditScForm(
          session.role,
          session.userId,
          existing.ownerId,
          existing.status
        );
        if (!canEdit) {
          throw new Error("Anda tidak memiliki wewenang untuk mengedit form ini.");
        }
      }

      const isNew = !existing;

      // Determine if there are any changes
      let hasChanges = isNew;
      if (existing) {
        if (
          existing.periodeAwal !== periodeAwal ||
          existing.lamaPeriode !== lamaPeriode ||
          existing.persenResepDokter !== persenResepDokter ||
          existing.jumlahKaryawan !== jumlahKaryawan ||
          existing.jumlahPasien !== jumlahPasien ||
          existing.jumlahPasienResep !== jumlahPasienResep ||
          existing.jumlahPasienNonResep !== jumlahPasienNonResep
        ) {
          hasChanges = true;
        }

        // Compare persons
        if (!hasChanges) {
          const existingNiks = existing.persons.map((p: any) => p.nik_ktp).sort();
          const newNiks = personItems.map((p) => p.nik_ktp).sort();
          if (JSON.stringify(existingNiks) !== JSON.stringify(newNiks)) {
            hasChanges = true;
          }
        }

        // Compare products
        if (!hasChanges) {
          const newProds = products
            .filter((p) => p.kodeProduk && (parseFloat(p.qtyPerBulan) || 0) > 0)
            .map((p) => ({
              kodeProduk: p.kodeProduk,
              produkKompetitor: p.produkKompetitor || null,
              qtyPerBulan: parseInt(p.qtyPerBulan, 10) || 0,
              persenMatriksSc: parseFloat(parseFloat(p.persenMatriksSc || "0").toFixed(2)),
              persenDiskon: parseFloat(parseFloat(p.persenDiskon || "0").toFixed(2)),
              persenCashback: parseFloat(parseFloat(p.persenCashback || "0").toFixed(2)),
              rencanaTotalBiaya: parseFloat(p.rencanaTotalBiaya.toFixed(2)),
            }))
            .sort((a, b) => a.kodeProduk.localeCompare(b.kodeProduk));

          const oldProds = existing.products
            .map((p: any) => ({
              kodeProduk: p.kodeProduk,
              produkKompetitor: p.produkKompetitor || null,
              qtyPerBulan: p.qtyPerBulan,
              persenMatriksSc: parseFloat(Number(p.persenMatriksSc).toFixed(2)),
              persenDiskon: parseFloat(Number(p.persenDiskon).toFixed(2)),
              persenCashback: parseFloat(Number(p.persenCashback).toFixed(2)),
              rencanaTotalBiaya: parseFloat(Number(p.rencanaTotalBiaya).toFixed(2)),
            }))
            .sort((a: any, b: any) => a.kodeProduk.localeCompare(b.kodeProduk));

          if (JSON.stringify(newProds) !== JSON.stringify(oldProds)) {
            hasChanges = true;
          }
        }

        // Compare entertain items
        if (!hasChanges) {
          const newEntertain = entertainList
            .filter((e) => (parseFloat(e.value) || 0) > 0)
            .map((e) => ({
              periodeMonth: e.month,
              biayaEntertain: parseFloat(parseFloat(e.value || "0").toFixed(2)),
            }))
            .sort((a, b) => a.periodeMonth.localeCompare(b.periodeMonth));

          const oldEntertain = existing.entertainItems
            .map((e: any) => ({
              periodeMonth: e.periodeMonth,
              biayaEntertain: parseFloat(Number(e.biayaEntertain).toFixed(2)),
            }))
            .sort((a: any, b: any) => a.periodeMonth.localeCompare(b.periodeMonth));

          if (JSON.stringify(newEntertain) !== JSON.stringify(oldEntertain)) {
            hasChanges = true;
          }
        }
      }

      if (!hasChanges && existing) {
        return existing;
      }

      // Resolve namaOutlet: use param if provided, otherwise lookup DB / Nexus API
      let namaOutlet: string | null = namaOutletParam || null;
      if (!namaOutlet) {
        const dbOutlet = await tx.outlet.findUnique({
          where: { kodePI: outletId },
          select: { namaOutlet: true },
        });
        if (dbOutlet?.namaOutlet) {
          namaOutlet = dbOutlet.namaOutlet;
        } else {
          try {
            const directOutlets = await getSalesCounterOutletsDirect(session.userId);
            const matched = directOutlets.find((o) => o.kodePI === outletId);
            if (matched?.namaOutlet) {
              namaOutlet = matched.namaOutlet;
            }
          } catch {
            // ignore lookup error
          }
        }
      }

      // Save PoaScForm since there are changes
      let poaSc: any = null;
      if (existing) {
        poaSc = await tx.poaScForm.update({
          where: { id: existing.id },
          data: {
            periodeAwal,
            lamaPeriode,
            status: existing.status,
            version: existing.version + 1,
            namaOutlet: namaOutlet || existing.namaOutlet,
            persenResepDokter,
            jumlahKaryawan: jumlahKaryawan ?? null,
            jumlahPasien: jumlahPasien ?? null,
            jumlahPasienResep: jumlahPasienResep ?? null,
            jumlahPasienNonResep: jumlahPasienNonResep ?? null,
          },
        });
      } else {
        poaSc = await tx.poaScForm.create({
          data: {
            period,
            periodeAwal,
            lamaPeriode,
            kodePI: outletId,
            namaOutlet,
            ownerId: session.userId,
            status: PoaStatus.DRAFT,
            version: 1,
            persenResepDokter,
            jumlahKaryawan: jumlahKaryawan ?? null,
            jumlahPasien: jumlahPasien ?? null,
            jumlahPasienResep: jumlahPasienResep ?? null,
            jumlahPasienNonResep: jumlahPasienNonResep ?? null,
          },
        });
      }

      // 4. Delete old child items
      if (!isNew) {
        await tx.poaScPersonItem.deleteMany({ where: { poaScId: poaSc.id } });
        await tx.poaScProductItem.deleteMany({ where: { poaScId: poaSc.id } });
        await tx.poaScEntertainItem.deleteMany({ where: { poaScId: poaSc.id } });
      }

      // 5. Insert new person items
      await tx.poaScPersonItem.createMany({
        data: personItems.map((p) => ({
          poaScId: poaSc.id,
          nik_ktp: p.nik_ktp,
          personName: p.personName,
          positionName: p.positionName,
        })),
      });

      // Query real product names
      const pCodes = products.map((p) => p.kodeProduk).filter(Boolean);
      const masterProducts = await tx.product.findMany({
        where: { kodeProduk: { in: pCodes } },
        select: { kodeProduk: true, namaProduk: true },
      });

      // 6. Insert new product items
      await tx.poaScProductItem.createMany({
        data: products
          .filter((p) => p.kodeProduk && (parseFloat(p.qtyPerBulan) || 0) > 0)
          .map((p) => {
            const master = masterProducts.find((mp: any) => mp.kodeProduk === p.kodeProduk);
            return {
              poaScId: poaSc.id,
              kodeProduk: p.kodeProduk,
              namaProduk: master?.namaProduk || p.kodeProduk,
              produkKompetitor: p.produkKompetitor || null,
              qtyPerBulan: parseInt(p.qtyPerBulan, 10) || 0,
              persenMatriksSc: parseFloat(p.persenMatriksSc) || 0,
              persenDiskon: parseFloat(p.persenDiskon) || 0,
              persenCashback: parseFloat(p.persenCashback) || 0,
              rencanaTotalBiaya: p.rencanaTotalBiaya || 0,
            };
          }),
      });

      // 7. Insert new entertain items
      await tx.poaScEntertainItem.createMany({
        data: entertainList
          .filter((e) => (parseFloat(e.value) || 0) > 0)
          .map((e) => ({
            poaScId: poaSc.id,
            periodeMonth: e.month,
            biayaEntertain: parseFloat(e.value) || 0,
          })),
      });

      // 8. Create Audit Log
      const snapshot: any = {};
      if (!isNew && existing) {
        // Compare root scalar columns
        if (existing.persenResepDokter !== persenResepDokter) {
          snapshot.old_persenResepDokter = existing.persenResepDokter;
          snapshot.new_persenResepDokter = persenResepDokter;
        }

        if ((existing.jumlahKaryawan ?? null) !== (jumlahKaryawan ?? null)) {
          snapshot.old_jumlahKaryawan = existing.jumlahKaryawan ?? null;
          snapshot.new_jumlahKaryawan = jumlahKaryawan ?? null;
        }

        if ((existing.jumlahPasien ?? null) !== (jumlahPasien ?? null)) {
          snapshot.old_jumlahPasien = existing.jumlahPasien ?? null;
          snapshot.new_jumlahPasien = jumlahPasien ?? null;
        }

        if ((existing.jumlahPasienResep ?? null) !== (jumlahPasienResep ?? null)) {
          snapshot.old_jumlahPasienResep = existing.jumlahPasienResep ?? null;
          snapshot.new_jumlahPasienResep = jumlahPasienResep ?? null;
        }

        if ((existing.jumlahPasienNonResep ?? null) !== (jumlahPasienNonResep ?? null)) {
          snapshot.old_jumlahPasienNonResep = existing.jumlahPasienNonResep ?? null;
          snapshot.new_jumlahPasienNonResep = jumlahPasienNonResep ?? null;
        }

        if ((existing.periodeAwal ?? null) !== (periodeAwal ?? null)) {
          snapshot.old_periodeAwal = existing.periodeAwal ?? null;
          snapshot.new_periodeAwal = periodeAwal ?? null;
        }

        if ((existing.lamaPeriode ?? null) !== (lamaPeriode ?? null)) {
          snapshot.old_lamaPeriode = existing.lamaPeriode ?? null;
          snapshot.new_lamaPeriode = lamaPeriode ?? null;
        }

        // Compare person staff items
        const oldPersonMap = new Map<string, any>(existing.persons.map((p: any) => [p.nik_ktp, p]));
        const newPersonMap = new Map<string, any>(personItems.map((p: any) => [p.nik_ktp, p]));
        const personDiffs: any[] = [];

        for (const [nik, p] of newPersonMap.entries()) {
          if (!oldPersonMap.has(nik)) {
            personDiffs.push({
              type: "add",
              nik_ktp: p.nik_ktp,
              personName: p.personName,
              positionName: p.positionName,
            });
          }
        }
        for (const [nik, p] of oldPersonMap.entries()) {
          if (!newPersonMap.has(nik)) {
            personDiffs.push({
              type: "delete",
              nik_ktp: p.nik_ktp,
              personName: p.personName,
              positionName: p.positionName,
            });
          }
        }
        if (personDiffs.length > 0) {
          snapshot.person = personDiffs;
        }

        // Compare products
        const oldProdMap = new Map<string, any>(
          existing.products.map((p: any) => [
            p.kodeProduk,
            {
              kodeProduk: p.kodeProduk,
              namaProduk: p.namaProduk,
              produkKompetitor: p.produkKompetitor || null,
              qtyPerBulan: p.qtyPerBulan,
              persenMatriksSc: parseFloat(Number(p.persenMatriksSc).toFixed(2)),
              persenDiskon: parseFloat(Number(p.persenDiskon).toFixed(2)),
              persenCashback: parseFloat(Number(p.persenCashback).toFixed(2)),
              rencanaTotalBiaya: parseFloat(Number(p.rencanaTotalBiaya).toFixed(2)),
            },
          ])
        );

        const activeNewProducts = products
          .filter((p) => p.kodeProduk && (parseFloat(p.qtyPerBulan) || 0) > 0)
          .map((p) => {
            const master = masterProducts.find((mp: any) => mp.kodeProduk === p.kodeProduk);
            return {
              kodeProduk: p.kodeProduk,
              namaProduk: master?.namaProduk || p.kodeProduk,
              produkKompetitor: p.produkKompetitor || null,
              qtyPerBulan: parseInt(p.qtyPerBulan, 10) || 0,
              persenMatriksSc: parseFloat(parseFloat(p.persenMatriksSc || "0").toFixed(2)),
              persenDiskon: parseFloat(parseFloat(p.persenDiskon || "0").toFixed(2)),
              persenCashback: parseFloat(parseFloat(p.persenCashback || "0").toFixed(2)),
              rencanaTotalBiaya: parseFloat((p.rencanaTotalBiaya || 0).toFixed(2)),
            };
          });

        const newProdMap = new Map<string, any>(activeNewProducts.map((p) => [p.kodeProduk, p]));
        const productDiffs: any[] = [];

        for (const [code, newP] of newProdMap.entries()) {
          const oldP = oldProdMap.get(code);
          if (!oldP) {
            productDiffs.push({
              type: "add",
              ...newP,
            });
          } else {
            const updateDiff: any = { type: "update", kodeProduk: code, namaProduk: newP.namaProduk };
            let updated = false;

            if (oldP.produkKompetitor !== newP.produkKompetitor) {
              updateDiff.old_produkKompetitor = oldP.produkKompetitor;
              updateDiff.new_produkKompetitor = newP.produkKompetitor;
              updated = true;
            }
            if (oldP.qtyPerBulan !== newP.qtyPerBulan) {
              updateDiff.old_qtyPerBulan = oldP.qtyPerBulan;
              updateDiff.new_qtyPerBulan = newP.qtyPerBulan;
              updated = true;
            }
            if (oldP.persenMatriksSc !== newP.persenMatriksSc) {
              updateDiff.old_persenMatriksSc = oldP.persenMatriksSc;
              updateDiff.new_persenMatriksSc = newP.persenMatriksSc;
              updated = true;
            }
            if (oldP.persenDiskon !== newP.persenDiskon) {
              updateDiff.old_persenDiskon = oldP.persenDiskon;
              updateDiff.new_persenDiskon = newP.persenDiskon;
              updated = true;
            }
            if (oldP.persenCashback !== newP.persenCashback) {
              updateDiff.old_persenCashback = oldP.persenCashback;
              updateDiff.new_persenCashback = newP.persenCashback;
              updated = true;
            }
            if (oldP.rencanaTotalBiaya !== newP.rencanaTotalBiaya) {
              updateDiff.old_rencanaTotalBiaya = oldP.rencanaTotalBiaya;
              updateDiff.new_rencanaTotalBiaya = newP.rencanaTotalBiaya;
              updated = true;
            }

            if (updated) {
              productDiffs.push(updateDiff);
            }
          }
        }

        for (const [code, oldP] of oldProdMap.entries()) {
          if (!newProdMap.has(code)) {
            productDiffs.push({
              type: "delete",
              ...oldP,
            });
          }
        }

        if (productDiffs.length > 0) {
          snapshot.product = productDiffs;
        }

        // Compare entertain items
        const oldEntMap = new Map<string, number>(
          existing.entertainItems.map((e: any) => [
            e.periodeMonth,
            parseFloat(Number(e.biayaEntertain).toFixed(2)),
          ])
        );

        const activeNewEntertain = entertainList
          .filter((e) => (parseFloat(e.value) || 0) > 0)
          .map((e) => ({
            periodeMonth: e.month,
            biayaEntertain: parseFloat(parseFloat(e.value || "0").toFixed(2)),
          }));

        const newEntMap = new Map<string, number>(activeNewEntertain.map((e) => [e.periodeMonth, e.biayaEntertain]));
        const entertainDiffs: any[] = [];

        for (const [month, newCost] of newEntMap.entries()) {
          const oldCost = oldEntMap.get(month);
          if (oldCost === undefined) {
            entertainDiffs.push({
              type: "add",
              periodeMonth: month,
              biayaEntertain: newCost,
            });
          } else if (oldCost !== newCost) {
            entertainDiffs.push({
              type: "update",
              periodeMonth: month,
              old_biayaEntertain: oldCost,
              new_biayaEntertain: newCost,
            });
          }
        }

        for (const [month, oldCost] of oldEntMap.entries()) {
          if (!newEntMap.has(month)) {
            entertainDiffs.push({
              type: "delete",
              periodeMonth: month,
              biayaEntertain: oldCost,
            });
          }
        }

        if (entertainDiffs.length > 0) {
          snapshot.entertain = entertainDiffs;
        }

        snapshot.notes = "";
      }

      await tx.poaScAuditLog.create({
        data: {
          poaScId: poaSc.id,
          actorId: session.userId,
          action: isNew ? AuditAction.CREATE : AuditAction.UPDATE,
          fromStatus: existing?.status || null,
          toStatus: poaSc.status,
          snapshot: snapshot,
        },
      });

      return poaSc;
    });

    revalidatePath(`/sc/${period}`);
    revalidatePath(`/sc/${period}/edit`);
    if (scIdParam) {
      revalidatePath(`/sc/${scIdParam}`);
      revalidatePath(`/sc/${period}/edit/${scIdParam}`);
    }
    return { ok: true, poaScId: result.id };
  } catch (error: any) {
    console.error("Failed to save Sales Counter POA:", error);
    return { ok: false, error: error?.message || "Gagal menyimpan data ke database." };
  }
}

export async function deleteSalesCounterFormAction(poaScId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  try {
    const poaSc = await prisma.poaScForm.findUnique({
      where: { id: poaScId },
    });
    if (!poaSc) return { ok: false, error: "POA tidak ditemukan." };
    if (poaSc.ownerId !== session.userId) return { ok: false, error: "Tidak memiliki akses untuk menghapus POA ini." };

    await prisma.poaScForm.delete({
      where: { id: poaScId },
    });

    revalidatePath(`/sc/${poaSc.period}`);
    return { ok: true };
  } catch (error: any) {
    console.error("Failed to delete Sales Counter POA:", error);
    return { ok: false, error: error?.message || "Gagal menghapus data." };
  }
}

export async function deleteSalesCounterPeriodAction(period: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  try {
    const drafts = await prisma.poaScForm.findMany({
      where: { ownerId: session.userId, period, status: PoaStatus.DRAFT },
    });
    if (drafts.length === 0) return { ok: false, error: "Tidak ada draf yang dapat dihapus." };

    await prisma.poaScForm.deleteMany({
      where: { ownerId: session.userId, period, status: PoaStatus.DRAFT },
    });

    revalidatePath("/sc/dashboard");
    return { ok: true };
  } catch (error: any) {
    console.error("Failed to delete Sales Counter Period POA:", error);
    return { ok: false, error: error?.message || "Gagal menghapus data." };
  }
}

export async function updateSalesCounterPeriodAction(
  currentPeriod: string,
  newPeriod: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) return { ok: false, error: WRITE_BLOCKED_MESSAGE };

  const period = newPeriod.trim();
  if (!/^\d{4}-Q[1-4]$/.test(period)) return { ok: false, error: "Format periode tidak valid." };
  if (period === currentPeriod) return { ok: true };

  const drafts = await prisma.poaScForm.findMany({
    where: { ownerId: session.userId, period: currentPeriod },
    include: { entertainItems: true },
  });

  if (drafts.length === 0) return { ok: false, error: "POA Sales Counter tidak ditemukan." };

  const nonEditable = drafts.some((d: any) => d.status !== PoaStatus.DRAFT && d.status !== PoaStatus.REVISI);
  if (nonEditable) {
    return { ok: false, error: "Periode hanya bisa diubah selama status Draft/Revisi." };
  }

  const existingInNewPeriod = await prisma.poaScForm.findFirst({
    where: { ownerId: session.userId, period },
  });
  if (existingInNewPeriod) {
    return { ok: false, error: `Draft ${period} untuk Sales Counter sudah ada.` };
  }

  const mNew = period.match(/^(\d{4})-Q([1-4])$/);
  if (!mNew) return { ok: false, error: "Format periode baru tidak valid." };
  const newYear = parseInt(mNew[1], 10);
  const newQ = parseInt(mNew[2], 10);
  const newStartMonthNum = (newQ - 1) * 3 + 1;
  const newPeriodeAwal = `${newYear}${String(newStartMonthNum).padStart(2, "0")}`;

  const mOld = currentPeriod.match(/^(\d{4})-Q([1-4])$/);
  const oldYear = mOld ? parseInt(mOld[1], 10) : newYear;
  const oldQ = mOld ? parseInt(mOld[2], 10) : 1;
  const oldStartMonthNum = (oldQ - 1) * 3 + 1;

  const monthShift = (newYear - oldYear) * 12 + (newStartMonthNum - oldStartMonthNum);

  try {
    await prisma.$transaction(async (tx: any) => {
      for (const draft of drafts) {
        await tx.poaScForm.update({
          where: { id: draft.id },
          data: {
            period,
            periodeAwal: newPeriodeAwal,
          },
        });

        for (const ent of draft.entertainItems) {
          const yyyy = parseInt(ent.periodeMonth.slice(0, 4), 10);
          const mm = parseInt(ent.periodeMonth.slice(4), 10);
          const totalMonths = yyyy * 12 + (mm - 1) + monthShift;
          const shiftedYyyy = Math.floor(totalMonths / 12);
          const shiftedMm = (totalMonths % 12) + 1;
          const newPeriodeMonth = `${shiftedYyyy}${String(shiftedMm).padStart(2, "0")}`;

          await tx.poaScEntertainItem.update({
            where: { id: ent.id },
            data: { periodeMonth: newPeriodeMonth },
          });
        }
      }
    });

    revalidatePath(`/sc/${currentPeriod}`);
    revalidatePath(`/sc/${period}`);
    return { ok: true };
  } catch (error: any) {
    console.error("Failed to update Sales Counter period:", error);
    return { ok: false, error: error?.message || "Gagal memperbarui periode Sales Counter." };
  }
}

export async function getDiskonDplDpfByPeriodeAction(periode: string) {
  console.log(`[getDiskonDplDpfByPeriodeAction] querying for period: "${periode}"`);
  if (!periode) return { list: [], diskonPeriode: "" };
  try {
    let list = await prisma.diskonDplDpf.findMany({
      where: {
        periode: periode,
      },
    });

    let diskonPeriode = periode;

    if (list.length === 0) {
      const latest = (await prisma.diskonDplDpf.findFirst({
        where: { periode: { lte: periode } },
        orderBy: { periode: "desc" },
        select: { periode: true },
      })) ?? (await prisma.diskonDplDpf.findFirst({
        orderBy: { periode: "desc" },
        select: { periode: true },
      }));

      if (latest?.periode) {
        diskonPeriode = latest.periode;
        list = await prisma.diskonDplDpf.findMany({
          where: { periode: latest.periode },
        });
      }
    }

    console.log(`[getDiskonDplDpfByPeriodeAction] returning ${list.length} records for diskonPeriode: "${diskonPeriode}"`);
    return {
      diskonPeriode,
      list: list.map((item: DiskonDplDpf) => ({
        proCode: item.proCode,
        diskon: Number(item.diskon.toString()),
        periode: item.periode,
      })),
    };
  } catch (error) {
    console.error("Failed to fetch DiskonDplDpf by period:", error);
    return { list: [], diskonPeriode: "" };
  }
}

