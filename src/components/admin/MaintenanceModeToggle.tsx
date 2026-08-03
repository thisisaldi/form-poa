"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { getMaintenanceStateAction, setMaintenanceModeAction, setViewOnlyModeAction } from "@/app/actions/maintenance";

/**
 * Admin-only switches for the site-wide maintenance lockout (2026-07-31) and
 * the softer view-only mode (2026-08-03) — see MaintenanceMode in
 * schema.prisma and the (app) layout's gating check / isWriteBlocked in
 * src/lib/maintenance.ts. Full lockout: every non-ADMIN role sees only the
 * maintenance screen on every route. View-only: non-ADMIN roles keep normal
 * read access, but every mutating action is rejected — meant for DB
 * migrations where you want writes frozen without a full outage.
 */
export function MaintenanceModeToggle() {
  const [enabled, setEnabled] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [viewOnlyPending, startViewOnlyTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    getMaintenanceStateAction().then((state) => {
      setEnabled(state.enabled);
      setViewOnly(state.viewOnly);
      setMessage(state.message ?? "");
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  function save(nextEnabled: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setMaintenanceModeAction(nextEnabled, message);
      if (!res.ok) { setError(res.error ?? "Gagal menyimpan."); return; }
      setEnabled(nextEnabled);
      setSavedAt(Date.now());
    });
  }

  function saveViewOnly(next: boolean) {
    setError(null);
    startViewOnlyTransition(async () => {
      const res = await setViewOnlyModeAction(next);
      if (!res.ok) { setError(res.error ?? "Gagal menyimpan."); return; }
      setViewOnly(next);
      setSavedAt(Date.now());
    });
  }

  if (!loaded) return null;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: enabled ? "var(--color-red)" : "var(--color-border)" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Mode Maintenance</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
              Kalau aktif, semua user selain Admin hanya melihat halaman maintenance — tidak bisa buka halaman lain sama sekali.
            </p>
          </div>
          <span className="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap"
            style={{ background: enabled ? "var(--color-red-light)" : "var(--color-green-light, #E6F5EC)", color: enabled ? "var(--color-red)" : "var(--color-green, #008f42)" }}>
            {enabled ? "AKTIF" : "NONAKTIF"}
          </span>
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Pesan yang ditampilkan ke user (opsional, default: pesan standar)"
          rows={2}
          className="input-field w-full text-sm"
        />

        <div className="flex gap-2">
          {!enabled ? (
            <Button type="button" size="sm" variant="danger" onClick={() => save(true)} disabled={isPending}>
              {isPending ? "Mengaktifkan…" : "Aktifkan Maintenance"}
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => save(false)} disabled={isPending}>
              {isPending ? "Menonaktifkan…" : "Matikan Maintenance"}
            </Button>
          )}
          {enabled && (
            <Button type="button" size="sm" variant="secondary" onClick={() => save(true)} disabled={isPending}>
              Simpan Pesan
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: viewOnly ? "var(--color-warning, #f59e0b)" : "var(--color-border)" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Mode View-Only</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
              Kalau aktif, semua user selain Admin tetap bisa buka & lihat semua halaman seperti biasa, tapi semua aksi yang
              mengubah data (submit, approve, edit, tambah, hapus, dst) ditolak. Buat freeze DB sementara migrasi/maintenance
              tanpa perlu lockout total.
            </p>
          </div>
          <span className="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap"
            style={{ background: viewOnly ? "var(--color-warning-bg, #fef3c7)" : "var(--color-green-light, #E6F5EC)", color: viewOnly ? "var(--color-warning, #f59e0b)" : "var(--color-green, #008f42)" }}>
            {viewOnly ? "AKTIF" : "NONAKTIF"}
          </span>
        </div>

        <div className="flex gap-2">
          {!viewOnly ? (
            <Button type="button" size="sm" variant="danger" onClick={() => saveViewOnly(true)} disabled={viewOnlyPending}>
              {viewOnlyPending ? "Mengaktifkan…" : "Aktifkan View-Only"}
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => saveViewOnly(false)} disabled={viewOnlyPending}>
              {viewOnlyPending ? "Menonaktifkan…" : "Matikan View-Only"}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}
      {savedAt && !error && (
        <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Tersimpan.</p>
      )}
    </div>
  );
}
