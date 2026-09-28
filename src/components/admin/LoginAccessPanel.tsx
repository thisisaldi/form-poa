"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { getLoginAccessAction, setLoginAccessAction } from "@/app/actions/loginAccess";

const ROLES = ["MR", "ASM", "SM", "NSM", "GM", "SFE", "SD", "VIEWER"];

/**
 * Admin-only login block (LoginAccessConfig in schema.prisma, enforced in
 * verifyNip). Per-environment: each DB has its own setting. Checked roles
 * can't log in, except NIPs listed in the exception box. ADMIN is never blocked.
 */
export function LoginAccessPanel() {
  const [blocked, setBlocked] = useState<string[]>([]);
  const [nips, setNips] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getLoginAccessAction().then((s) => {
      setBlocked(s.blockedRoles);
      setNips(s.allowedNips.join("\n"));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  function toggle(role: string) {
    setBlocked((b) => (b.includes(role) ? b.filter((r) => r !== role) : [...b, role]));
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setLoginAccessAction(blocked, nips);
      if (!res.ok) { setError(res.error ?? "Gagal menyimpan."); return; }
      setSaved(true);
    });
  }

  if (!loaded) return null;

  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: blocked.length ? "var(--color-red)" : "var(--color-border)" }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Blokir Login per Role</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
          Role yang dicentang tidak bisa login di environment ini, kecuali NIP yang ada di daftar pengecualian. Admin tidak pernah diblokir.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        {ROLES.map((r) => (
          <label key={r} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={blocked.includes(r)} onChange={() => toggle(r)} />
            {r}
          </label>
        ))}
      </div>

      <textarea
        value={nips}
        onChange={(e) => setNips(e.target.value)}
        placeholder="NIP pengecualian (boleh login walau rolenya diblokir), satu per baris atau pisah koma"
        rows={3}
        className="input-field w-full text-sm"
      />

      <Button type="button" size="sm" onClick={save} disabled={isPending}>
        {isPending ? "Menyimpan…" : "Simpan"}
      </Button>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}
      {saved && !error && <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Tersimpan.</p>}
    </div>
  );
}
