"use client";

import { useState, useTransition } from "react";
import { updateSpNonSalesMemoNoSpAction, toggleSpNonSalesMemoSignedAction, type SalesSupportMemoRow } from "@/app/actions/poaStandarisasi";

export function SalesSupportMemoTable({ rows }: { rows: SalesSupportMemoRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>Belum ada memo yang digenerate.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: "var(--color-text-faint)" }}>
            <th className="text-left py-2 pr-3">Nomor</th>
            <th className="text-left py-2 pr-3">Outlet</th>
            <th className="text-left py-2 pr-3">Pengusul</th>
            <th className="text-left py-2 pr-3">Digenerate</th>
            <th className="text-left py-2 pr-3">No SP Memo</th>
            <th className="text-left py-2 pr-3">Sudah di-sign</th>
            <th className="text-left py-2">Dokumen (buat GOJ)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <MemoRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemoRow({ row }: { row: SalesSupportMemoRow }) {
  const [noSp, setNoSp] = useState(row.noSp ?? "");
  const [signed, setSigned] = useState(!!row.signedAt);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleNoSpBlur() {
    if (noSp === (row.noSp ?? "")) return;
    startTransition(async () => {
      try {
        await updateSpNonSalesMemoNoSpAction(row.id, noSp);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal menyimpan.");
      }
    });
  }

  function handleToggleSigned(next: boolean) {
    setSigned(next);
    startTransition(async () => {
      try {
        await toggleSpNonSalesMemoSignedAction(row.id, next);
      } catch (e) {
        setSigned(!next);
        setError(e instanceof Error ? e.message : "Gagal menyimpan.");
      }
    });
  }

  return (
    <tr style={{ borderTop: "1px solid var(--color-border)" }}>
      <td className="py-2 pr-3 font-medium">{row.nomor}</td>
      <td className="py-2 pr-3">{row.namaOutlet}</td>
      <td className="py-2 pr-3">{row.namaPengusul}</td>
      <td className="py-2 pr-3" style={{ color: "var(--color-text-faint)" }}>{new Date(row.generatedAt).toLocaleDateString("id-ID")}</td>
      <td className="py-2 pr-3">
        <input
          type="text"
          value={noSp}
          onChange={(e) => setNoSp(e.target.value)}
          onBlur={handleNoSpBlur}
          placeholder="Isi nomor…"
          className="rounded px-2 py-1 text-xs w-40"
          style={{ border: "1px solid var(--color-border)" }}
        />
      </td>
      <td className="py-2 pr-3">
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={signed} onChange={(e) => handleToggleSigned(e.target.checked)} />
          {signed && row.signedByNama ? `oleh ${row.signedByNama}` : "belum"}
        </label>
        {error && <div className="text-xs mt-0.5" style={{ color: "var(--color-error)" }}>{error}</div>}
      </td>
      <td className="py-2">
        <div className="flex flex-col gap-1">
          <a href={`/api/poa-standarisasi/dokumen/${row.driveFileId}`} target="_blank" rel="noreferrer" className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>
            Memo
          </a>
          {row.buktiStandarisasi.length === 0 ? (
            <span className="text-xs" style={{ color: "var(--color-error)" }}>⚠ Belum ada bukti standarisasi</span>
          ) : (
            row.buktiStandarisasi.map((doc) => (
              <a key={doc.id} href={`/api/poa-standarisasi/dokumen/${doc.driveFileId}`} target="_blank" rel="noreferrer" className="text-xs" style={{ color: "var(--color-blue)" }} title={doc.fileName}>
                Bukti: {doc.fileName}
              </a>
            ))
          )}
        </div>
      </td>
    </tr>
  );
}
