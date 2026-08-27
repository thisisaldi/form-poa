/**
 * GET /api/poa-standarisasi/dokumen/[driveFileId]
 *
 * Authenticated download proxy for confidential POA Standarisasi documents
 * (NIE/COA/CPOB/Flyer, Permintaan SP Non Sales, Form Approval Standarisasi,
 * Surat Approval Standarisasi KFT, Bukti TTD — 2026-08-27, user flagged
 * these as confidential). Every download in the wizard UI points here
 * instead of a raw Google Drive link — a Drive link's visibility follows the
 * shared folder's sharing setting, not this app's own authz, so anyone with
 * the link could otherwise view it regardless of role. This route resolves
 * the file back to its owning pengajuan server-side (never trusts a
 * client-supplied pengajuanId), checks canViewPoaStandarisasi, logs the
 * access (who/when/which file — PoaStandarisasiFileAccessLog), then streams
 * the bytes.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeAndLogPoaStandarisasiFileAccess } from "@/app/actions/poaStandarisasi";
import { downloadFileFromDrive } from "@/lib/googleDrive";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ driveFileId: string }> }
) {
  const { driveFileId } = await params;

  try {
    await authorizeAndLogPoaStandarisasiFileAccess(driveFileId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Tidak berhak mengakses dokumen ini.";
    const status = message === "Sesi tidak valid." ? 401 : message === "File tidak ditemukan." ? 404 : 403;
    return NextResponse.json({ error: message }, { status });
  }

  try {
    const { buffer, mimeType, fileName } = await downloadFileFromDrive(driveFileId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal mengambil dokumen." }, { status: 500 });
  }
}
