"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import {
  getPoaDoctorsApiCredentialStateAction,
  setPoaDoctorsApiCredentialAction,
  type PoaDoctorsApiCredentialState,
} from "@/app/actions/admin";

/**
 * Admin-only panel to set/rotate the HTTP Basic Auth credential external apps
 * use to call /api/poa-doctors without a session cookie (2026-08-19) — see
 * PoaDoctorsApiCredential in schema.prisma and apiBasicAuth.ts. The current
 * password is never fetched back (only hashed in the DB) — this only shows
 * whether a credential is configured and lets the admin overwrite it.
 */
export function PoaDoctorsApiCredentialPanel() {
  const [state, setState] = useState<PoaDoctorsApiCredentialState | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    getPoaDoctorsApiCredentialStateAction().then(setState).catch(() => setState({ configured: false, username: null, updatedAt: null }));
  }, []);

  function save() {
    setError(null);
    if (!username.trim() || !password.trim()) {
      setError("Username dan password wajib diisi.");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("username", username.trim());
      formData.set("password", password);
      const res = await setPoaDoctorsApiCredentialAction(formData);
      if (!res.ok) { setError(res.error ?? "Gagal menyimpan."); return; }
      setPassword("");
      setSavedAt(Date.now());
      getPoaDoctorsApiCredentialStateAction().then(setState);
    });
  }

  if (!state) return null;

  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>API Basic Auth — /api/poa-doctors</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
            Kredensial ini dipakai aplikasi eksternal untuk memanggil <code>/api/poa-doctors</code> tanpa login session.
            Password disimpan ter-hash, tidak bisa dilihat lagi setelah disimpan — untuk mengganti, isi ulang kedua field di bawah.
          </p>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap"
          style={{
            background: state.configured ? "var(--color-green-light, #E6F5EC)" : "var(--color-warning-bg, #fef3c7)",
            color: state.configured ? "var(--color-green, #008f42)" : "var(--color-warning, #f59e0b)",
          }}>
          {state.configured ? "SUDAH DISET" : "BELUM DISET"}
        </span>
      </div>

      {state.configured && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Username saat ini: <strong>{state.username}</strong>
          {state.updatedAt && ` · diperbarui ${new Date(state.updatedAt).toLocaleString("id-ID")}`}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username baru"
          className="input-field text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password baru"
          className="input-field text-sm"
        />
      </div>

      <Button type="button" size="sm" onClick={save} disabled={isPending}>
        {isPending ? "Menyimpan…" : state.configured ? "Ganti Kredensial" : "Simpan Kredensial"}
      </Button>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}
      {savedAt && !error && (
        <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Tersimpan.</p>
      )}
    </div>
  );
}
