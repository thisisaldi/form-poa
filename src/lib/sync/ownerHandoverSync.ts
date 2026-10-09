/**
 * Handover kepemilikan POA saat orang resign (docs/poa-gt-handover/, 2026-10-09).
 *
 * Aturan: dokumen milik user nonaktif (org sync) dipindah ke MR aktif yang SEKARANG
 * memegang outlet-nya (MrOutletAssignment periode terbaru) — itu arti "GT diisi orang
 * baru". Dipilih assignment outlet, bukan Outlet.kodeGT: kodeGT hanya terisi ~1.7%
 * outlet dan user nonaktif tidak punya kodeWilayah. Syarat: tepat SATU kandidat MR;
 * nol (GT masih kosong) atau lebih dari satu (ambigu) dilewati dan dilaporkan.
 * Mencakup PoaForm, PoaStandarisasi, PoaScForm. KPI/absensi sengaja tidak disentuh.
 * Status, approval, Deal, dan versi tidak berubah — hanya ownerId.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface OwnerHandoverResult {
  moved: { poa: number; standarisasi: number; sc: number };
  skippedNoCandidate: number;
  skippedAmbiguous: number;
  errors: string[];
}

export async function runOwnerHandoverSync(opts: { dryRun?: boolean } = {}): Promise<OwnerHandoverResult> {
  const result: OwnerHandoverResult = { moved: { poa: 0, standarisasi: 0, sc: 0 }, skippedNoCandidate: 0, skippedAmbiguous: 0, errors: [] };

  const periode = (await prisma.mrOutletAssignment.aggregate({ _max: { periode: true } }))._max.periode;
  if (!periode) return result; // no assignment data at all — never guess

  const [poas, standarisasi, scForms] = await Promise.all([
    prisma.poaForm.findMany({
      where: { owner: { isActive: false } },
      select: { id: true, ownerId: true, items: { select: { kodePI: true } } },
    }) as Promise<{ id: string; ownerId: string; items: { kodePI: string | null }[] }[]>,
    prisma.poaStandarisasi.findMany({ where: { owner: { isActive: false } }, select: { id: true, ownerId: true, kodePI: true } }) as Promise<{ id: string; ownerId: string; kodePI: string }[]>,
    prisma.poaScForm.findMany({ where: { owner: { isActive: false } }, select: { id: true, ownerId: true, kodePI: true } }) as Promise<{ id: string; ownerId: string; kodePI: string }[]>,
  ]);

  const allPIs = new Set<string>();
  for (const p of poas) for (const i of p.items) if (i.kodePI) allPIs.add(i.kodePI);
  for (const s of standarisasi) allPIs.add(s.kodePI);
  for (const s of scForms) allPIs.add(s.kodePI);
  if (allPIs.size === 0) return result;

  const assignments = await prisma.mrOutletAssignment.findMany({
    where: { periode, kodePI: { in: [...allPIs] }, user: { isActive: true, role: "MR", isDummy: false } },
    select: { nipMR: true, kodePI: true },
  }) as { nipMR: string; kodePI: string }[];
  const holdersByPI = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = holdersByPI.get(a.kodePI) ?? new Set<string>();
    set.add(a.nipMR);
    holdersByPI.set(a.kodePI, set);
  }

  /** The single active MR holding any of these outlets, or null (+ counted skip reason). */
  function resolveNewOwner(kodePIs: string[]): string | null {
    const nips = new Set<string>();
    for (const pi of kodePIs) for (const n of holdersByPI.get(pi) ?? []) nips.add(n);
    if (nips.size === 0) { result.skippedNoCandidate++; return null; }
    if (nips.size > 1) { result.skippedAmbiguous++; return null; }
    return [...nips][0];
  }

  for (const p of poas) {
    const pis = [...new Set(p.items.map((i) => i.kodePI).filter(Boolean) as string[])];
    if (pis.length === 0) continue; // empty draft: nothing to lose
    const to = resolveNewOwner(pis);
    if (!to) continue;
    if (opts.dryRun) { result.moved.poa++; continue; }
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // ownerId in WHERE: a concurrent change makes this a no-op instead of overwriting it.
        const r = await tx.poaForm.updateMany({ where: { id: p.id, ownerId: p.ownerId }, data: { ownerId: to } });
        if (r.count === 0) return;
        await tx.poaAuditLog.create({
          data: { poaId: p.id, actorId: to, action: "UPDATE", snapshot: { event: "HANDOVER_GT", fromOwner: p.ownerId, toOwner: to } },
        });
        result.moved.poa++;
      });
    } catch (e) {
      result.errors.push(`poa ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const s of standarisasi) {
    const to = resolveNewOwner([s.kodePI]);
    if (!to) continue;
    if (opts.dryRun) { result.moved.standarisasi++; continue; }
    try {
      const r = await prisma.poaStandarisasi.updateMany({ where: { id: s.id, ownerId: s.ownerId }, data: { ownerId: to } });
      result.moved.standarisasi += r.count;
    } catch (e) {
      result.errors.push(`standarisasi ${s.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const s of scForms) {
    const to = resolveNewOwner([s.kodePI]);
    if (!to) continue;
    if (opts.dryRun) { result.moved.sc++; continue; }
    try {
      // @@unique([kodePI, periodeAwal, ownerId]) can collide if the new owner already has the same form — P2002 lands in errors, row stays put.
      const r = await prisma.poaScForm.updateMany({ where: { id: s.id, ownerId: s.ownerId }, data: { ownerId: to } });
      result.moved.sc += r.count;
    } catch (e) {
      result.errors.push(`sc ${s.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
