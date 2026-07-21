"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Prisma, Role } from "@prisma/client";

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
    data: { nip, name, role: role as Role, email, nipAtasan, namaAtasan, syncedAt: new Date() },
  });

  return { ok: true };
}

export interface UserRow {
  nip: string; name: string; role: string; email: string | null;
  nipAtasan: string | null; isActive: boolean; isDummy: boolean;
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
  return rows.map((u: { nip: string; name: string; role: string; email: string | null; nipAtasan: string | null; isActive: boolean; isDummy: boolean }) =>
    ({ nip: u.nip, name: u.name, role: u.role, email: u.email, nipAtasan: u.nipAtasan, isActive: u.isActive, isDummy: u.isDummy }));
}

/** Update an existing staff account. NIP (the primary key) is not changeable here. */
export async function updateUserAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const nip = str(formData, "nip");
  const name = str(formData, "name");
  const role = str(formData, "role");
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
    data: { name, role: role as Role, email, nipAtasan, namaAtasan, isActive, isDummy },
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
}

/** Search outlets by Kode PI or name — capped at 20 results. */
export async function searchOutletsAction(query: string): Promise<OutletRow[]> {
  const q = query.trim();
  if (!q) return [];
  const rows = await prisma.outlet.findMany({
    where: { OR: [{ kodePI: { contains: q, mode: "insensitive" } }, { namaOutlet: { contains: q, mode: "insensitive" } }] },
    orderBy: { namaOutlet: "asc" },
    take: 20,
  });
  return rows.map((o: {
    kodePI: string; namaOutlet: string; statusOutlet: string | null; groupRS: string | null;
    sector: string | null; subSektor: string | null; kota: string | null; propinsi: string | null;
    kategori: string | null; namaGT: string | null; namaSub: string | null; namaArea: string | null; namaReg: string | null;
  }) => ({
    kodePI: o.kodePI, namaOutlet: o.namaOutlet, statusOutlet: o.statusOutlet, groupRS: o.groupRS,
    sector: o.sector, subSektor: o.subSektor, kota: o.kota, propinsi: o.propinsi, kategori: o.kategori,
    namaGT: o.namaGT, namaSub: o.namaSub, namaArea: o.namaArea, namaReg: o.namaReg,
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

  await prisma.product.create({
    data: {
      kodeProduk, namaProduk, namaGroupBrand, satuan,
      hna: new Prisma.Decimal(hna),
      zatAktif: str(formData, "zatAktif"),
      nilaiRPersen: nilaiRPersenPct != null ? new Prisma.Decimal(nilaiRPersenPct / 100) : null,
      satuanTerkecil: str(formData, "satuanTerkecil"),
      konversiPembagi: konversiPembagi != null ? new Prisma.Decimal(konversiPembagi) : null,
      syncedAt: new Date(),
    },
  });

  return { ok: true };
}

export interface ProductRow {
  kodeProduk: string; namaProduk: string; namaGroupBrand: string; satuan: string; hna: string;
  zatAktif: string | null; nilaiRPersen: string | null; satuanTerkecil: string | null; konversiPembagi: string | null;
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
  }) => ({
    kodeProduk: p.kodeProduk, namaProduk: p.namaProduk, namaGroupBrand: p.namaGroupBrand,
    satuan: p.satuan, hna: p.hna.toString(),
    zatAktif: p.zatAktif,
    nilaiRPersen: p.nilaiRPersen != null ? (parseFloat(p.nilaiRPersen.toString()) * 100).toString() : null,
    satuanTerkecil: p.satuanTerkecil,
    konversiPembagi: p.konversiPembagi?.toString() ?? null,
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

  await prisma.product.update({
    where: { kodeProduk },
    data: {
      namaProduk, namaGroupBrand, satuan,
      hna: new Prisma.Decimal(hna),
      zatAktif: str(formData, "zatAktif"),
      nilaiRPersen: nilaiRPersenPct != null ? new Prisma.Decimal(nilaiRPersenPct / 100) : null,
      satuanTerkecil: str(formData, "satuanTerkecil"),
      konversiPembagi: konversiPembagi != null ? new Prisma.Decimal(konversiPembagi) : null,
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

/** Update an existing doctor's name/spesialisasi/outlet. */
export async function updateCustomerAction(formData: FormData): Promise<AdminActionResult> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;

  const customerOutletId = str(formData, "customerOutletId");
  const namaCustomer = str(formData, "namaCustomer");
  const spesialisasi = str(formData, "spesialisasi");
  const kodePI = str(formData, "kodePI");

  if (!customerOutletId || !namaCustomer || !spesialisasi || !kodePI) {
    return { ok: false, error: "Nama, spesialisasi, dan outlet wajib diisi." };
  }

  const link = await prisma.customerOutlet.findUnique({ where: { id: customerOutletId } });
  if (!link) return { ok: false, error: "Data dokter tidak ditemukan." };

  const outlet = await prisma.outlet.findUnique({ where: { kodePI } });
  if (!outlet) return { ok: false, error: "Outlet tidak ditemukan." };

  // isFokus ("Rekomendasi PM") is exclusively driven by the official RS GROUP
  // curation spreadsheet (scripts/syncCustomers.ts Pass 2) — not editable here.
  await prisma.$transaction([
    prisma.customer.update({ where: { id: link.customerId }, data: { namaCustomer, spesialisasi } }),
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
