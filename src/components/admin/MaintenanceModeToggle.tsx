"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { getMaintenanceStateAction, setMaintenanceModeAction } from "@/app/actions/maintenance";

/**
 * Admin-only switch for the site-wide maintenance lockout (2026-07-31) — see
 * MaintenanceMode in schema.prisma and the (app) layout's gating check. When
 * ON, every non-ADMIN role sees only the maintenance screen on every route.
 */
export function MaintenanceModeToggle() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    getMaintenanceStateAction().then((state) => {
      setEnabled(state.enabled);
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

  if (!loaded) return null;

  return (
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

      {error && (
        <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}
      {savedAt && !error && (
        <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Tersimpan.</p>
      )}

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
  );
}
