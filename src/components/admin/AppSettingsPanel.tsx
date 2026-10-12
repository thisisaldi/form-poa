"use client";

import { useEffect, useState, useTransition } from "react";
import { getAppSettingRowsAction, setAppSettingAction, type AppSettingRow } from "@/app/actions/appSettings";
import { APP_SETTINGS, APP_SETTING_GROUP_LABELS, type AppSettingGroup, type AppSettingKey } from "@/lib/appSettingsRegistry";

/**
 * Pengaturan fitur on/off (export Excel, upload, DPL/DPF) — semua yang terdaftar di
 * src/lib/appSettingsRegistry.ts muncul di sini otomatis; mengubahnya tidak butuh deploy.
 */
export function AppSettingsPanel() {
  const [rows, setRows] = useState<AppSettingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<AppSettingKey | null>(null);
  const [, startTransition] = useTransition();

  async function load() {
    try { setRows(await getAppSettingRowsAction()); } catch (e) { setError(e instanceof Error ? e.message : "Gagal memuat."); }
  }
  useEffect(() => { void load(); }, []);

  function toggle(key: AppSettingKey, next: boolean) {
    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      const res = await setAppSettingAction(key, next);
      setPendingKey(null);
      if (!res.ok) return setError(res.error ?? "Gagal menyimpan.");
      await load();
    });
  }

  if (!rows) return error ? <p className="text-xs" style={{ color: "var(--color-red)" }}>{error}</p> : null;

  const groups = [...new Set(APP_SETTINGS.map((d) => d.group))] as AppSettingGroup[];
  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Pengaturan Fitur</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
          Nyalakan atau matikan fitur tanpa deploy. Perubahan berlaku untuk semua user dalam hitungan detik.
        </p>
      </div>
      {error && <p className="text-xs" style={{ color: "var(--color-red)" }}>{error}</p>}
      {groups.map((g) => (
        <div key={g} className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>{APP_SETTING_GROUP_LABELS[g]}</p>
          {APP_SETTINGS.filter((d) => d.group === g).map((d) => {
            const row = rows.find((r) => r.key === d.key);
            const on = row?.value ?? d.default;
            // Kill switch ".disabled": nilai true berarti fitur MATI — tampilkan sebagai status fitur, bukan nilai mentah.
            const isKillSwitch = d.key.endsWith(".disabled") || d.key.endsWith("Disabled");
            const featureOn = isKillSwitch ? !on : on;
            return (
              <div key={d.key} className="flex items-start justify-between gap-3 rounded-md px-3 py-2" style={{ background: "var(--color-bg-subtle)" }}>
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{d.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{d.description}</p>
                  {row?.overridden && row.updatedAt && (
                    <p className="text-[11px] mt-1" style={{ color: "var(--color-text-faint)" }}>
                      Diubah {new Date(row.updatedAt).toLocaleString("id-ID")}{row.updatedByNip ? ` oleh ${row.updatedByNip}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                    style={{
                      background: featureOn ? "var(--color-green-light, #E6F5EC)" : "var(--color-red-light)",
                      color: featureOn ? "var(--color-green, #008f42)" : "var(--color-red)",
                    }}>
                    {isKillSwitch ? (featureOn ? "FITUR AKTIF" : "FITUR MATI") : on ? "AKTIF" : "NONAKTIF"}
                  </span>
                  <button
                    type="button"
                    disabled={pendingKey === d.key}
                    onClick={() => toggle(d.key, !on)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md border disabled:opacity-50"
                    style={{ borderColor: "var(--color-border-strong, var(--color-border))", color: "var(--color-text)", background: "var(--color-surface, #fff)" }}
                  >
                    {pendingKey === d.key ? "Menyimpan…" : isKillSwitch ? (featureOn ? "Matikan" : "Aktifkan") : on ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
