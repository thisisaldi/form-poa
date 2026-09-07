"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hashSecret } from "@/lib/secretHash";
import { Prisma, Role, PoaStatus } from "@prisma/client";
import { getBlastInOutletSet } from "@/lib/outletBlastIn";

export interface AdminActionResult {
  ok: boolean;
  error?: string;
}

async function requireAdmin(): Promise<AdminActionResult> {
  const session = await getCurrentUser();
  if (!session) return { ok: false, error: "Sesi tidak valid." };
  if (session.role !== "ADMIN") return { ok: false, error: "Hanya admin yang bisa melakukan ini." };
  return { ok: true };
}

function str(formData: FormData, key: string): string | null {
  return (formData.get(key) as string | null)?.trim() || null;
}

function num(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/** Add a new staff account (MR/ASM/SM/NSM/GM/ADMIN). */
export async function createUserAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const nip = str(formData, "nip");
  const name = str(formData, "name");
  const role = str(formData, "role");
  const jabatan = str(formData, "jabatan");
  const email = str(formData, "email");
  const nipAtasan = str(formData, "nipAtasan");

  if (!nip || !name || !role) {
    return { ok: false, error: "NIP, nama, dan role wajib diisi." };
  }
  if (!(Object.values(Role) as string[]).includes(role)) {
    return { ok: false, error: "Role tidak valid." };
  }

  const existing = await prisma.user.findUnique({ where: { nip } });
  if (existing) return { ok: false, error: `NIP ${nip} sudah terdaftar atas nama ${existing.name}.` };

  let namaAtasan: string | null = null;
  if (nipAtasan) {
    const atasan = await prisma.user.findUnique({ where: { nip: nipAtasan } });
    if (!atasan) return { ok: false, error: `NIP atasan ${nipAtasan} tidak ditemukan.` };
    namaAtasan = atasan.name;
  }

  await prisma.user.create({
    data: { nip, name, role: role as Role, jabatan, email, nipAtasan, namaAtasan, syncedAt: new Date() },
  });

  return { ok: true };
}

export interface UserRow {
  nip: string; name: string; role: string; jabatan: string | null; email: string | null;
  nipAtasan: string | null; isActive: boolean; isDummy: boolean;
}

export interface MissingNexusUserRow {
  nip: string; nama: string; position: string; status: "missing" | "inactive";
}

/**
 * Diagnostic (read-only, no writes) for the "org sync isn't automated yet"
 * gap (2026-08-21) — lets an admin check who Nexus already knows about but
 * Postgres `User` doesn't yet reflect, without triggering a full runOrgSync()
 * (which upserts/deactivates). Compares live get_employees?project=ethical
 * against current `User` rows: "missing" = no User row at all for that NIP,
 * "inactive" = row exists but isActive=false (would flip to true on next sync).
 */
export async function checkNexusMissingUsersAction(): Promise<{ ok: boolean; error?: string; rows?: MissingNexusUserRow[] }> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  let employees;
  try {
    const { fetchAllEmployees } = await import("@/lib/sync/orgNexusInference");
    employees = await fetchAllEmployees();
  } catch (err) {
    return { ok: false, error: `Gagal ambil data dari Nexus: ${String(err)}` };
  }

  const nips = employees.map((e) => e.nip);
  const existing = await prisma.user.findMany({
    where: { nip: { in: nips } },
    select: { nip: true, isActive: true },
  });
  const existingByNip = new Map(existing.map((u: { nip: string; isActive: boolean }) => [u.nip, u.isActive]));

  const rows: MissingNexusUserRow[] = [];
  for (const e of employees) {
    const isActive = existingByNip.get(e.nip);
    if (isActive === undefined) rows.push({ nip: e.nip, nama: e.nama, position: e.position, status: "missing" });
    else if (!isActive) rows.push({ nip: e.nip, nama: e.nama, position: e.position, status: "inactive" });
  }
  rows.sort((a, b) => a.nama.localeCompare(b.nama));

  return { ok: true, rows };
}

/** Search staff accounts by NIP or name — capped at 20 results. */
export async function searchUsersAction(query: string): Promise<UserRow[]> {
  const q = query.trim();
  if (!q) return [];
  const rows = await prisma.user.findMany({
    where: { OR: [{ nip: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] },
    orderBy: { name: "asc" },
    take: 20,
  });
  return rows.map((u: { nip: string; name: string; role: string; jabatan: string | null; email: string | null; nipAtasan: string | null; isActive: boolean; isDummy: boolean }) =>
    ({ nip: u.nip, name: u.name, role: u.role, jabatan: u.jabatan, email: u.email, nipAtasan: u.nipAtasan, isActive: u.isActive, isDummy: u.isDummy }));
}

/**
 * Renames a user's NIP (the primary key). Every FK referencing User.nip
 * (PoaForm.ownerId/currentHolderId, PoaAuditLog.actorId,
 * MrOutletAssignment.nipMR, User.nipAtasan, CustomerPengajuan.submittedBy)
 * is declared ON UPDATE CASCADE at the DB level, so this one update
 * propagates everywhere atomically — no manual multi-table transaction
 * needed (unlike the historical NIP fixes done by hand before this existed).
 * Changes the user's login credential, so call this BEFORE any other field
 * update in the same save (the caller should re-target subsequent calls at
 * the new NIP).
 */
export async function renameUserNipAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const oldNip = str(formData, "oldNip");
  const newNip = str(formData, "newNip");
  if (!oldNip || !newNip) return { ok: false, error: "NIP lama dan baru wajib diisi." };
  if (oldNip === newNip) return { ok: true };

  const existing = await prisma.user.findUnique({ where: { nip: oldNip } });
  if (!existing) return { ok: false, error: `NIP ${oldNip} tidak ditemukan.` };

  const conflict = await prisma.user.findUnique({ where: { nip: newNip } });
  if (conflict) return { ok: false, error: `NIP ${newNip} sudah dipakai oleh ${conflict.name}.` };

  try {
    await prisma.user.update({ where: { nip: oldNip }, data: { nip: newNip } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Gagal mengubah NIP: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Update an existing staff account (NIP itself is renamed separately via renameUserNipAction). */
export async function updateUserAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const nip = str(formData, "nip");
  const name = str(formData, "name");
  const role = str(formData, "role");
  const jabatan = str(formData, "jabatan");
  const email = str(formData, "email");
  const nipAtasan = str(formData, "nipAtasan");
  const isActive = formData.get("isActive") === "true";
  const isDummy = formData.get("isDummy") === "true";

  if (!nip || !name || !role) return { ok: false, error: "NIP, nama, dan role wajib diisi." };
  if (!(Object.values(Role) as string[]).includes(role)) return { ok: false, error: "Role tidak valid." };

  const existing = await prisma.user.findUnique({ where: { nip } });
  if (!existing) return { ok: false, error: `NIP ${nip} tidak ditemukan.` };

  let namaAtasan: string | null = null;
  if (nipAtasan) {
    if (nipAtasan === nip) return { ok: false, error: "User tidak bisa jadi atasan diri sendiri." };
    const atasan = await prisma.user.findUnique({ where: { nip: nipAtasan } });
    if (!atasan) return { ok: false, error: `NIP atasan ${nipAtasan} tidak ditemukan.` };
    namaAtasan = atasan.name;
  }

  await prisma.user.update({
    where: { nip },
    data: { name, role: role as Role, jabatan, email, nipAtasan, namaAtasan, isActive, isDummy },
  });

  return { ok: true };
}

/** Delete a staff account. Fails safely (with a clear message) if other records still reference it. */
export async function deleteUserAction(nip: string): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  try {
    await prisma.user.delete({ where: { nip } });
    return { ok: true };
  } catch {
    return { ok: false, error: "User tidak bisa dihapus — masih ada POA, assignment, atau bawahan yang terhubung. Coba nonaktifkan saja (isActive) lewat Update." };
  }
}

export interface DummyChainResult extends AdminActionResult {
  /** The 4 NIPs created/updated, in NSM→MR order, when ok. */
  nips?: string[];
}

/**
 * Creates a self-contained MR → ASM → SM → NSM dummy account chain from one
 * reference NIP — same convention as scripts/generateDummyAccounts.ts /
 * addNationalDummyUsers.ts (prefix + the reference NIP's digit suffix), now
 * exposed as an admin UI action instead of a one-off script (2026-07-28
 * request). isDummy=true on all 4 (grants national/all-outlet access — see
 * getOutletsByUser/canCreatePoa); `loginable` sets isActive, which is what
 * actually gates login (see verifyNip in src/lib/auth.ts) — isDummy itself
 * no longer blocks login.
 */
export async function createDummyChainAction(formData: FormData): Promise<DummyChainResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const refNip = str(formData, "refNip");
  const name = str(formData, "name");
  const loginable = formData.get("loginable") === "true";

  if (!refNip || !name) return { ok: false, error: "NIP acuan dan nama wajib diisi." };

  const digits = refNip.replace(/^[A-Za-z]+/, "");
  if (!/^\d{4,}$/.test(digits)) {
    return { ok: false, error: "NIP acuan harus diakhiri minimal 4 digit angka (mis. P090282)." };
  }

  const ROLE_PREFIXES: { prefix: string; role: Role }[] = [
    { prefix: "NSM", role: Role.NSM },
    { prefix: "SM", role: Role.SM },
    { prefix: "ASM", role: Role.ASM },
    { prefix: "MR", role: Role.MR },
  ];

  const nips = ROLE_PREFIXES.map(({ prefix }) => `${prefix}${digits}`);
  const conflicts = await prisma.user.findMany({
    where: { nip: { in: nips } },
    select: { nip: true, name: true, isDummy: true },
  });
  const realConflict = conflicts.find((c: { nip: string; name: string; isDummy: boolean }) => !c.isDummy);
  if (realConflict) {
    return { ok: false, error: `${realConflict.nip} sudah dipakai oleh akun asli (${realConflict.name}) — pilih NIP acuan lain.` };
  }

  let prevNip: string | null = null;
  for (const { prefix, role } of ROLE_PREFIXES) {
    const nip = `${prefix}${digits}`;
    await prisma.user.upsert({
      where: { nip },
      create: { nip, name, role, nipAtasan: prevNip, isActive: loginable, isDummy: true },
      update: { name, role, nipAtasan: prevNip, isActive: loginable, isDummy: true },
    });
    prevNip = nip;
  }

  return { ok: true, nips };
}

/** Add a new outlet. */
export async function createOutletAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const kodePI = str(formData, "kodePI");
  const namaOutlet = str(formData, "namaOutlet");
  if (!kodePI || !namaOutlet) return { ok: false, error: "Kode PI dan nama outlet wajib diisi." };

  const existing = await prisma.outlet.findUnique({ where: { kodePI } });
  if (existing) return { ok: false, error: `Kode PI ${kodePI} sudah terdaftar atas nama outlet ${existing.namaOutlet}.` };

  await prisma.outlet.create({
    data: {
      kodePI, namaOutlet,
      statusOutlet: str(formData, "statusOutlet") ?? "A",
      groupRS: str(formData, "groupRS"),
      sector: str(formData, "sector"),
      subSektor: str(formData, "subSektor"),
      kota: str(formData, "kota"),
      propinsi: str(formData, "propinsi"),
      kategori: str(formData, "kategori"),
      namaGT: str(formData, "namaGT"),
      namaSub: str(formData, "namaSub"),
      namaArea: str(formData, "namaArea"),
      namaReg: str(formData, "namaReg"),
      syncedAt: new Date(),
    },
  });

  return { ok: true };
}

export interface OutletRow {
  kodePI: string; namaOutlet: string; statusOutlet: string | null; groupRS: string | null;
  sector: string | null; subSektor: string | null; kota: string | null; propinsi: string | null;
  kategori: string | null; namaGT: string | null; namaSub: string | null; namaArea: string | null; namaReg: string | null;
  isBlastIn?: boolean;
}

/** Search outlets by Kode PI or name — capped at 20 results. */
export async function searchOutletsAction(query: string): Promise<OutletRow[]> {
  const q = query.trim();
  if (!q) return [];
  const [rows, blastInSet] = await Promise.all([
    prisma.outlet.findMany({
      where: { OR: [{ kodePI: { contains: q, mode: "insensitive" } }, { namaOutlet: { contains: q, mode: "insensitive" } }] },
      orderBy: { namaOutlet: "asc" },
      take: 20,
    }),
    getBlastInOutletSet(),
  ]);
  return rows.map((o: {
    kodePI: string; namaOutlet: string; statusOutlet: string | null; groupRS: string | null;
    sector: string | null; subSektor: string | null; kota: string | null; propinsi: string | null;
    kategori: string | null; namaGT: string | null; namaSub: string | null; namaArea: string | null; namaReg: string | null;
  }) => ({
    kodePI: o.kodePI, namaOutlet: o.namaOutlet, statusOutlet: o.statusOutlet, groupRS: o.groupRS,
    sector: o.sector, subSektor: o.subSektor, kota: o.kota, propinsi: o.propinsi, kategori: o.kategori,
    namaGT: o.namaGT, namaSub: o.namaSub, namaArea: o.namaArea, namaReg: o.namaReg,
    isBlastIn: blastInSet.has(o.kodePI),
  }));
}

/** Update an existing outlet. Kode PI (the primary key) is not changeable here. */
export async function updateOutletAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const kodePI = str(formData, "kodePI");
  const namaOutlet = str(formData, "namaOutlet");
  if (!kodePI || !namaOutlet) return { ok: false, error: "Kode PI dan nama outlet wajib diisi." };

  const existing = await prisma.outlet.findUnique({ where: { kodePI } });
  if (!existing) return { ok: false, error: `Kode PI ${kodePI} tidak ditemukan.` };

  await prisma.outlet.update({
    where: { kodePI },
    data: {
      namaOutlet,
      statusOutlet: str(formData, "statusOutlet") ?? "A",
      groupRS: str(formData, "groupRS"),
      sector: str(formData, "sector"),
      subSektor: str(formData, "subSektor"),
      kota: str(formData, "kota"),
      propinsi: str(formData, "propinsi"),
      kategori: str(formData, "kategori"),
      namaGT: str(formData, "namaGT"),
      namaSub: str(formData, "namaSub"),
      namaArea: str(formData, "namaArea"),
      namaReg: str(formData, "namaReg"),
    },
  });

  return { ok: true };
}

/**
 * Delete an outlet. This CASCADES: every MrOutletAssignment and CustomerOutlet
 * (doctor↔outlet link) pointing at it is deleted too — the caller's confirm
 * dialog must warn about this before calling.
 */
export async function deleteOutletAction(kodePI: string): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  try {
    await prisma.outlet.delete({ where: { kodePI } });
    return { ok: true };
  } catch {
    return { ok: false, error: "Outlet tidak bisa dihapus." };
  }
}

/** Add a new product. */
export async function createProductAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const kodeProduk = str(formData, "kodeProduk");
  const namaProduk = str(formData, "namaProduk");
  const namaGroupBrand = str(formData, "namaGroupBrand");
  const satuan = str(formData, "satuan");
  const hna = num(formData, "hna");

  if (!kodeProduk || !namaProduk || !namaGroupBrand || !satuan || hna == null || hna < 0) {
    return { ok: false, error: "Kode produk, nama produk, group brand, satuan, dan HNA wajib diisi dengan benar." };
  }

  const existing = await prisma.product.findUnique({ where: { kodeProduk } });
  if (existing) return { ok: false, error: `Kode produk ${kodeProduk} sudah terdaftar atas nama ${existing.namaProduk}.` };

  const nilaiRPersenPct = num(formData, "nilaiRPersen");
  const konversiPembagi = num(formData, "konversiPembagi");
  const qtyPerRxPasien = num(formData, "qtyPerRxPasien");
  const lamaPemberianHari = num(formData, "lamaPemberianHari");
  const jumlahPemberianPerHari = num(formData, "jumlahPemberianPerHari");

  await prisma.product.create({
    data: {
      kodeProduk, namaProduk, namaGroupBrand, satuan,
      hna: new Prisma.Decimal(hna),
      zatAktif: str(formData, "zatAktif"),
      nilaiRPersen: nilaiRPersenPct != null ? new Prisma.Decimal(nilaiRPersenPct / 100) : null,
      satuanTerkecil: str(formData, "satuanTerkecil"),
      konversiPembagi: konversiPembagi != null ? new Prisma.Decimal(konversiPembagi) : null,
      dosisKekuatanSediaan: str(formData, "dosisKekuatanSediaan"),
      qtyPerRxPasien: qtyPerRxPasien != null ? new Prisma.Decimal(qtyPerRxPasien) : null,
      lamaPemberianHari: lamaPemberianHari != null ? Math.round(lamaPemberianHari) : null,
      jumlahPemberianPerHari: jumlahPemberianPerHari != null ? new Prisma.Decimal(jumlahPemberianPerHari) : null,
      bentukSediaan: str(formData, "bentukSediaan"),
      packing: str(formData, "packing"),
      indikasi: str(formData, "indikasi"),
      syncedAt: new Date(),
    },
  });

  return { ok: true };
}

export interface ProductRow {
  kodeProduk: string; namaProduk: string; namaGroupBrand: string; satuan: string; hna: string;
  zatAktif: string | null; nilaiRPersen: string | null; satuanTerkecil: string | null; konversiPembagi: string | null;
  dosisKekuatanSediaan: string | null; qtyPerRxPasien: string | null; lamaPemberianHari: number | null;
  jumlahPemberianPerHari: string | null; bentukSediaan: string | null; packing: string | null; indikasi: string | null;
}

/** Search products by Kode Produk or name — capped at 20 results. */
export async function searchProductsAction(query: string): Promise<ProductRow[]> {
  const q = query.trim();
  if (!q) return [];
  const rows = await prisma.product.findMany({
    where: { OR: [{ kodeProduk: { contains: q, mode: "insensitive" } }, { namaProduk: { contains: q, mode: "insensitive" } }] },
    orderBy: { namaProduk: "asc" },
    take: 20,
  });
  return rows.map((p: {
    kodeProduk: string; namaProduk: string; namaGroupBrand: string; satuan: string;
    hna: { toString(): string }; zatAktif: string | null;
    nilaiRPersen: { toString(): string } | null; satuanTerkecil: string | null; konversiPembagi: { toString(): string } | null;
    dosisKekuatanSediaan: string | null; qtyPerRxPasien: { toString(): string } | null; lamaPemberianHari: number | null;
    jumlahPemberianPerHari: { toString(): string } | null; bentukSediaan: string | null; packing: string | null; indikasi: string | null;
  }) => ({
    kodeProduk: p.kodeProduk, namaProduk: p.namaProduk, namaGroupBrand: p.namaGroupBrand,
    satuan: p.satuan, hna: p.hna.toString(),
    zatAktif: p.zatAktif,
    nilaiRPersen: p.nilaiRPersen != null ? (parseFloat(p.nilaiRPersen.toString()) * 100).toString() : null,
    satuanTerkecil: p.satuanTerkecil,
    konversiPembagi: p.konversiPembagi?.toString() ?? null,
    dosisKekuatanSediaan: p.dosisKekuatanSediaan,
    qtyPerRxPasien: p.qtyPerRxPasien?.toString() ?? null,
    lamaPemberianHari: p.lamaPemberianHari,
    jumlahPemberianPerHari: p.jumlahPemberianPerHari?.toString() ?? null,
    bentukSediaan: p.bentukSediaan,
    packing: p.packing,
    indikasi: p.indikasi,
  }));
}

/** Update an existing product. Kode Produk (the primary key) is not changeable here. */
export async function updateProductAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const kodeProduk = str(formData, "kodeProduk");
  const namaProduk = str(formData, "namaProduk");
  const namaGroupBrand = str(formData, "namaGroupBrand");
  const satuan = str(formData, "satuan");
  const hna = num(formData, "hna");

  if (!kodeProduk || !namaProduk || !namaGroupBrand || !satuan || hna == null || hna < 0) {
    return { ok: false, error: "Kode produk, nama produk, group brand, satuan, dan HNA wajib diisi dengan benar." };
  }

  const existing = await prisma.product.findUnique({ where: { kodeProduk } });
  if (!existing) return { ok: false, error: `Kode produk ${kodeProduk} tidak ditemukan.` };

  const nilaiRPersenPct = num(formData, "nilaiRPersen");
  const konversiPembagi = num(formData, "konversiPembagi");
  const qtyPerRxPasien = num(formData, "qtyPerRxPasien");
  const lamaPemberianHari = num(formData, "lamaPemberianHari");
  const jumlahPemberianPerHari = num(formData, "jumlahPemberianPerHari");

  await prisma.product.update({
    where: { kodeProduk },
    data: {
      namaProduk, namaGroupBrand, satuan,
      hna: new Prisma.Decimal(hna),
      zatAktif: str(formData, "zatAktif"),
      nilaiRPersen: nilaiRPersenPct != null ? new Prisma.Decimal(nilaiRPersenPct / 100) : null,
      satuanTerkecil: str(formData, "satuanTerkecil"),
      konversiPembagi: konversiPembagi != null ? new Prisma.Decimal(konversiPembagi) : null,
      dosisKekuatanSediaan: str(formData, "dosisKekuatanSediaan"),
      qtyPerRxPasien: qtyPerRxPasien != null ? new Prisma.Decimal(qtyPerRxPasien) : null,
      lamaPemberianHari: lamaPemberianHari != null ? Math.round(lamaPemberianHari) : null,
      jumlahPemberianPerHari: jumlahPemberianPerHari != null ? new Prisma.Decimal(jumlahPemberianPerHari) : null,
      bentukSediaan: str(formData, "bentukSediaan"),
      packing: str(formData, "packing"),
      indikasi: str(formData, "indikasi"),
    },
  });

  return { ok: true };
}

/** Delete a product. Historical POA line items keep their own denormalized snapshot, so this is safe. */
export async function deleteProductAction(kodeProduk: string): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  try {
    await prisma.product.delete({ where: { kodeProduk } });
    return { ok: true };
  } catch {
    return { ok: false, error: "Produk tidak bisa dihapus." };
  }
}

// ─── Customer (User + Spesialisasi) CRUD ────────────────────────────────────
// A Customer (doctor) is linked to one or more outlets via CustomerOutlet — the
// admin list/edit/delete operates on that flattened (customer × outlet) row,
// identified by the CustomerOutlet's own id.

export interface CustomerRow {
  customerOutletId: string; customerId: string;
  namaCustomer: string; spesialisasi: string; kodeCustomer: string | null;
  kodePI: string; namaOutlet: string; isFokus: boolean;
}

/** Search doctors by name — capped at 20 results (one row per outlet they're linked to). */
export async function searchCustomersAction(query: string): Promise<CustomerRow[]> {
  const q = query.trim();
  if (!q) return [];
  const rows = await prisma.customerOutlet.findMany({
    where: { customer: { namaCustomer: { contains: q, mode: "insensitive" } } },
    include: { customer: true, outlet: true },
    orderBy: { customer: { namaCustomer: "asc" } },
    take: 20,
  });
  return rows.map((r: {
    id: string; customerId: string; kodePI: string; isFokus: boolean;
    customer: { namaCustomer: string; spesialisasi: string; kodeCustomer: string | null };
    outlet: { namaOutlet: string };
  }) => ({
    customerOutletId: r.id, customerId: r.customerId,
    namaCustomer: r.customer.namaCustomer, spesialisasi: r.customer.spesialisasi, kodeCustomer: r.customer.kodeCustomer,
    kodePI: r.kodePI, namaOutlet: r.outlet.namaOutlet, isFokus: r.isFokus,
  }));
}

/** Update an existing doctor's name/spesialisasi/outlet/kode customer. */
export async function updateCustomerAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const customerOutletId = str(formData, "customerOutletId");
  const namaCustomer = str(formData, "namaCustomer");
  const spesialisasi = str(formData, "spesialisasi");
  const kodePI = str(formData, "kodePI");
  const kodeCustomer = str(formData, "kodeCustomer"); // optional — null clears it

  if (!customerOutletId || !namaCustomer || !spesialisasi || !kodePI) {
    return { ok: false, error: "Nama, spesialisasi, dan outlet wajib diisi." };
  }

  const link = await prisma.customerOutlet.findUnique({ where: { id: customerOutletId } });
  if (!link) return { ok: false, error: "Data dokter tidak ditemukan." };

  const outlet = await prisma.outlet.findUnique({ where: { kodePI } });
  if (!outlet) return { ok: false, error: "Outlet tidak ditemukan." };

  if (kodeCustomer) {
    const dup = await prisma.customer.findUnique({ where: { kodeCustomer } });
    if (dup && dup.id !== link.customerId) {
      return { ok: false, error: `Kode Customer ${kodeCustomer} sudah dipakai oleh ${dup.namaCustomer}.` };
    }
  }

  // isFokus ("Rekomendasi PM") is exclusively driven by the official RS GROUP
  // curation spreadsheet (scripts/syncCustomers.ts Pass 2) — not editable here.
  await prisma.$transaction([
    prisma.customer.update({ where: { id: link.customerId }, data: { namaCustomer, spesialisasi, kodeCustomer } }),
    prisma.customerOutlet.update({ where: { id: customerOutletId }, data: { kodePI } }),
  ]);

  return { ok: true };
}

/** Delete a doctor↔outlet link. If it was that doctor's only outlet, the Customer record is removed too. */
export async function deleteCustomerAction(customerOutletId: string): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const link = await prisma.customerOutlet.findUnique({ where: { id: customerOutletId } });
  if (!link) return { ok: false, error: "Data dokter tidak ditemukan." };

  try {
    const siblingCount = await prisma.customerOutlet.count({ where: { customerId: link.customerId } });
    if (siblingCount <= 1) {
      await prisma.customer.delete({ where: { id: link.customerId } }); // cascades the last CustomerOutlet row too
    } else {
      await prisma.customerOutlet.delete({ where: { id: customerOutletId } });
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Data dokter tidak bisa dihapus." };
  }
}

// ─── Outlet ↔ MR assignment CRUD ─────────────────────────────────────────────
// Manual override on top of MrOutletAssignment (normally kept in sync by
// scripts/importStrukturVerifiedKAM.ts) — an outlet can have more than one
// assignee at once (see the SHADOW-pair case in that script), so this is
// additive/removable per row rather than a single-value "set owner" field.

function currentPeriode(): number {
  const now = new Date();
  return now.getFullYear() * 100 + (now.getMonth() + 1);
}

export interface OutletAssignmentRow {
  kodePI: string; namaOutlet: string;
  coveredByNip: string | null; coveredByRole: string | null;
  assignments: { id: string; nipMR: string; namaMR: string }[];
}

/**
 * Search outlets by Kode PI/name OR by their currently-assigned MR's NIP/name,
 * with their current-periode MrOutletAssignment(s). Either match surfaces the
 * outlet — e.g. searching an MR's name finds every outlet they currently hold.
 */
export async function searchOutletAssignmentsAction(query: string): Promise<OutletAssignmentRow[]> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return [];

  const q = query.trim();
  if (!q) return [];
  const periode = currentPeriode();

  const [outletsByName, mrMatchedAssignments] = await Promise.all([
    prisma.outlet.findMany({
      where: { OR: [{ kodePI: { contains: q, mode: "insensitive" } }, { namaOutlet: { contains: q, mode: "insensitive" } }] },
      orderBy: { namaOutlet: "asc" },
      take: 20,
    }),
    prisma.mrOutletAssignment.findMany({
      where: {
        periode,
        OR: [{ nipMR: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }],
      },
      select: { kodePI: true },
      take: 50,
    }),
  ]);

  const kodePIsFromMR = [...new Set(mrMatchedAssignments.map((a: { kodePI: string }) => a.kodePI))]
    .filter((k) => !outletsByName.some((o: { kodePI: string }) => o.kodePI === k));
  const outletsByMR = kodePIsFromMR.length > 0
    ? await prisma.outlet.findMany({ where: { kodePI: { in: kodePIsFromMR } } })
    : [];

  const outlets = [...outletsByName, ...outletsByMR];
  const kodePIs = outlets.map((o: { kodePI: string }) => o.kodePI);
  const assignments = kodePIs.length > 0
    ? await prisma.mrOutletAssignment.findMany({
        where: { kodePI: { in: kodePIs }, periode },
        include: { user: { select: { name: true } } },
      })
    : [];

  const byOutlet = new Map<string, { id: string; nipMR: string; namaMR: string }[]>();
  for (const a of assignments as { id: string; kodePI: string; nipMR: string; user: { name: string } }[]) {
    const list = byOutlet.get(a.kodePI) ?? [];
    list.push({ id: a.id, nipMR: a.nipMR, namaMR: a.user.name });
    byOutlet.set(a.kodePI, list);
  }

  return outlets.map((o: { kodePI: string; namaOutlet: string; coveredByNip: string | null; coveredByRole: string | null }) => ({
    kodePI: o.kodePI, namaOutlet: o.namaOutlet,
    coveredByNip: o.coveredByNip, coveredByRole: o.coveredByRole,
    assignments: byOutlet.get(o.kodePI) ?? [],
  }));
}

/** Assign an outlet to an MR for the current periode. Additive — doesn't remove other assignees. */
export async function addOutletAssignmentAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const kodePI = str(formData, "kodePI");
  const nipMR = str(formData, "nipMR");
  if (!kodePI || !nipMR) return { ok: false, error: "Outlet dan NIP MR wajib diisi." };

  const outlet = await prisma.outlet.findUnique({ where: { kodePI } });
  if (!outlet) return { ok: false, error: "Outlet tidak ditemukan." };
  const user = await prisma.user.findUnique({ where: { nip: nipMR } });
  if (!user) return { ok: false, error: `NIP ${nipMR} tidak ditemukan.` };

  const periode = currentPeriode();
  await prisma.mrOutletAssignment.upsert({
    where: { nipMR_kodePI_periode: { nipMR, kodePI, periode } },
    create: { nipMR, kodePI, periode, syncedAt: new Date() },
    update: { syncedAt: new Date() },
  });

  return { ok: true };
}

/** Remove a single outlet↔MR assignment row. */
export async function removeOutletAssignmentAction(id: string): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  try {
    await prisma.mrOutletAssignment.delete({ where: { id } });
    return { ok: true };
  } catch {
    return { ok: false, error: "Assignment tidak bisa dihapus." };
  }
}

// ─── All-POA browser (Admin oversight) ──────────────────────────────────────
// canView() already grants ADMIN unrestricted access to every PoaForm, but
// there was no page to actually browse/search across all of them — only the
// dashboard's "last 10 updated" list, scoped to whatever the logged-in role
// can see. This gives admin a dedicated searchable list across every MR.

export interface PoaSearchRow {
  id: string;
  period: string;
  status: string;
  ownerNip: string;
  ownerName: string;
  itemCount: number;
  estimasiTotal: number;
  target: number | null;
  updatedAt: string;
}

/** Search all POAs by owner NIP/name, optionally filtered by period/status — capped at 30 results. */
export async function searchAllPoaAction(query: string, period?: string, status?: string): Promise<PoaSearchRow[]> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return [];

  const q = query.trim();
  const where: Prisma.PoaFormWhereInput = {};
  if (q) {
    where.owner = { OR: [{ nip: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] };
  }
  if (period?.trim()) where.period = period.trim();
  if (status?.trim() && (Object.values(PoaStatus) as string[]).includes(status.trim())) {
    where.status = status.trim() as PoaStatus;
  }

  const rows = await prisma.poaForm.findMany({
    where,
    include: {
      owner: { select: { nip: true, name: true } },
      items: { select: { rencanaTotalBiaya: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });

  type Row = {
    id: string; period: string; status: string; target: Prisma.Decimal | null; updatedAt: Date;
    owner: { nip: string; name: string };
    items: { rencanaTotalBiaya: Prisma.Decimal }[];
  };
  return (rows as Row[]).map((p) => ({
    id: p.id,
    period: p.period,
    status: p.status,
    ownerNip: p.owner.nip,
    ownerName: p.owner.name,
    itemCount: p.items.length,
    estimasiTotal: p.items.reduce((s: number, it) => s + (parseFloat(it.rencanaTotalBiaya.toString()) || 0), 0),
    target: p.target ? parseFloat(p.target.toString()) : null,
    updatedAt: p.updatedAt.toISOString(),
  }));
}

// ─── /api/poa-doctors Basic Auth credential (2026-08-19) ──────────────────────
//
// DB-backed instead of an env var so an ADMIN can rotate it from the Admin
// page without a redeploy — see PoaDoctorsApiCredential in schema.prisma and
// apiBasicAuth.ts. Password is hashed (scrypt) before it ever reaches the DB;
// the state action below deliberately never returns it, hashed or not — the
// UI only shows whether a credential is configured, not its value.

export interface PoaDoctorsApiCredentialState {
  configured: boolean;
  username: string | null;
  updatedAt: string | null;
}

export async function getPoaDoctorsApiCredentialStateAction(): Promise<PoaDoctorsApiCredentialState> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return { configured: false, username: null, updatedAt: null };

  const row = await prisma.poaDoctorsApiCredential.findUnique({ where: { id: 1 } });
  if (!row) return { configured: false, username: null, updatedAt: null };
  return { configured: true, username: row.username, updatedAt: row.updatedAt.toISOString() };
}

/** Sets/rotates the Basic Auth credential external apps use to call /api/poa-doctors. */
export async function setPoaDoctorsApiCredentialAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;
  const session = await getCurrentUser();

  const username = str(formData, "username");
  const password = formData.get("password") as string | null;
  if (!username || !password) return { ok: false, error: "Username dan password wajib diisi." };

  const { hash, salt } = hashSecret(password);
  await prisma.poaDoctorsApiCredential.upsert({
    where: { id: 1 },
    update: { username, passwordHash: hash, passwordSalt: salt, updatedByNip: session?.userId },
    create: { id: 1, username, passwordHash: hash, passwordSalt: salt, updatedByNip: session?.userId },
  });
  return { ok: true };
}

// ─── Google Drive survey folder (2026-08-27) ───────────────────────────────
//
// DB-backed instead of GOOGLE_DRIVE_SURVEY_FOLDER_ID env var so an ADMIN can
// set/change it from the Admin page without a redeploy — see
// GoogleDriveConfig in schema.prisma and src/lib/googleDrive.ts. Not a
// secret (just a Drive folder id), unlike PoaDoctorsApiCredential's password
// — the current value is shown as-is, not hashed.

export interface GoogleDriveConfigState {
  surveyFolderId: string | null;
  kftApprovalFolderId: string | null;
  formApprovalFolderId: string | null;
  updatedAt: string | null;
}

const EMPTY_GOOGLE_DRIVE_CONFIG_STATE: GoogleDriveConfigState = {
  surveyFolderId: null,
  kftApprovalFolderId: null,
  formApprovalFolderId: null,
  updatedAt: null,
};

export async function getGoogleDriveConfigStateAction(): Promise<GoogleDriveConfigState> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return EMPTY_GOOGLE_DRIVE_CONFIG_STATE;

  const row = await prisma.googleDriveConfig.findUnique({ where: { id: 1 } });
  return {
    surveyFolderId: row?.surveyFolderId ?? null,
    kftApprovalFolderId: row?.kftApprovalFolderId ?? null,
    formApprovalFolderId: row?.formApprovalFolderId ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/** Sets/changes the shared Drive folders — "Input Data Survey", Surat Approval Standarisasi KFT, and Form Approval Standarisasi each have their own, independently settable. */
export async function setGoogleDriveFolderIdAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;
  const session = await getCurrentUser();

  const surveyFolderId = str(formData, "surveyFolderId");
  if (!surveyFolderId) return { ok: false, error: "Folder ID Data Survey wajib diisi." };
  const kftApprovalFolderId = str(formData, "kftApprovalFolderId") || null;
  const formApprovalFolderId = str(formData, "formApprovalFolderId") || null;

  await prisma.googleDriveConfig.upsert({
    where: { id: 1 },
    update: { surveyFolderId, kftApprovalFolderId, formApprovalFolderId, updatedByNip: session?.userId },
    create: { id: 1, surveyFolderId, kftApprovalFolderId, formApprovalFolderId, updatedByNip: session?.userId },
  });
  return { ok: true };
}
