/**
 * POST /api/survey/upload
 *
 * "Input Data Survey" (docs/survey-pasien-features/, item #10 dari daftar 13
 * task 2026-08-10) — MR upload file Excel, diteruskan ke shared Google Drive
 * via service account. App tidak parse isi file, murni jadi perantara upload
 * + catat audit trail (SurveyUploadLog).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isWriteBlocked, WRITE_BLOCKED_MESSAGE } from "@/lib/maintenance";
import { getOutletsForSurveyUpload } from "@/lib/masterData";
import { uploadFileToSurveyDrive, isGoogleDriveConfigured } from "@/lib/googleDrive";
import { SURVEY_SUMBER_OPTIONS } from "@/lib/surveySumber";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB — docs/survey-pasien-features/01-business-rules.md OQ-1
// docs/TODO.md #18 (2026-08-13) — ZIP added alongside Excel (MR bundling
// multiple files/photos together, per "Support Format File ZIP" request).
const ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".zip"];
const MIME_BY_EXT: Record<string, string> = {
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};
const PERIODE_RE = /^\d{6}$/; // YYYYMM

function sanitizeForFileName(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, "-").trim();
}

/** Riwayat upload milik MR yang login (docs/survey-pasien-features/01-business-rules.md OQ-4). */
export async function GET() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const logs = await prisma.surveyUploadLog.findMany({
    where: { uploaderNip: session.userId },
    include: { outlet: { select: { namaOutlet: true } } },
    orderBy: { uploadedAt: "desc" },
    take: 50,
  });

  return NextResponse.json(
    logs.map((l: (typeof logs)[number]) => ({
      id: l.id,
      namaOutlet: l.outlet.namaOutlet,
      periode: l.periode,
      namaFile: l.namaFile,
      driveFileId: l.driveFileId,
      biayaData: l.biayaData != null ? parseFloat(l.biayaData.toString()) : null,
      sumber: l.sumber,
      uploadedAt: l.uploadedAt,
    }))
  );
}

export async function POST(req: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (await isWriteBlocked(session.role)) {
    return NextResponse.json({ error: WRITE_BLOCKED_MESSAGE }, { status: 423 });
  }
  if (!isGoogleDriveConfigured) {
    return NextResponse.json({ error: "Fitur upload survey belum dikonfigurasi." }, { status: 503 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const kodePI = (formData.get("kodePI") as string | null)?.trim() ?? "";
  const periode = (formData.get("periode") as string | null)?.trim() ?? "";
  // Biaya Data / Sumber (docs/TODO.md #18) — both optional for now (not yet
  // confirmed as required by stakeholder), validated if present.
  const biayaDataRaw = (formData.get("biayaData") as string | null)?.trim() ?? "";
  const sumberRaw = (formData.get("sumber") as string | null)?.trim() ?? "";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File wajib diisi." }, { status: 400 });
  }
  if (!kodePI) {
    return NextResponse.json({ error: "Nama RS/Outlet wajib diisi." }, { status: 400 });
  }
  if (!PERIODE_RE.test(periode)) {
    return NextResponse.json({ error: "Periode wajib format YYYYMM (mis. 202608)." }, { status: 400 });
  }
  let biayaData: number | null = null;
  if (biayaDataRaw) {
    biayaData = parseFloat(biayaDataRaw);
    if (isNaN(biayaData) || biayaData < 0) {
      return NextResponse.json({ error: "Biaya Data harus berupa angka ≥ 0." }, { status: 400 });
    }
  }
  if (sumberRaw && !(SURVEY_SUMBER_OPTIONS as readonly string[]).includes(sumberRaw)) {
    return NextResponse.json({ error: "Sumber tidak valid." }, { status: 400 });
  }

  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: "File harus berformat .xlsx, .xls, atau .zip." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File kosong." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: `Ukuran file maksimum ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.` }, { status: 400 });
  }

  // Outlet dibatasi ke coverage user yang login — MR/ADMIN scope sendiri,
  // ASM/SM/NSM scope seluruh subtree MR-nya (2026-08-10 widen, lihat
  // docs/survey-pasien-features/03-ui-and-access.md §5). Jangan percaya
  // kodePI dari client begitu saja.
  const myOutlets = await getOutletsForSurveyUpload(session);
  const outlet = myOutlets.find((o) => o.kodePI === kodePI);
  if (!outlet) {
    return NextResponse.json({ error: "Outlet tidak ditemukan di coverage Anda." }, { status: 403 });
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  const namaFile = `${timestamp} - Data Survey ${sanitizeForFileName(outlet.namaOutlet)} Periode ${periode} oleh ${sanitizeForFileName(session.name)}`;

  let driveFileId: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";
    const result = await uploadFileToSurveyDrive(namaFile, mimeType, buffer);
    driveFileId = result.driveFileId;
  } catch (err) {
    console.error("[survey/upload] Google Drive upload failed:", err);
    // detail = real error message, surfaced to the client so it shows up in
    // the browser console/network tab — server logs aren't reachable by
    // whoever's debugging a failed upload from the browser side.
    return NextResponse.json(
      { error: "Upload ke Google Drive gagal, coba lagi.", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  const log = await prisma.surveyUploadLog.create({
    data: {
      uploaderNip: session.userId,
      kodePI,
      periode,
      namaFile,
      driveFileId,
      biayaData,
      sumber: sumberRaw || null,
    },
  });

  return NextResponse.json({
    id: log.id,
    namaFile: log.namaFile,
    driveFileId: log.driveFileId,
    uploadedAt: log.uploadedAt,
  });
}
