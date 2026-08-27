"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import {
  getGoogleDriveConfigStateAction,
  setGoogleDriveFolderIdAction,
  type GoogleDriveConfigState,
} from "@/app/actions/admin";

/**
 * Admin-only panel to set/change the shared Drive folder "Input Data Survey"
 * + POA Standarisasi uploads go into (2026-08-27) — see GoogleDriveConfig in
 * schema.prisma and src/lib/googleDrive.ts. Not a secret (unlike
 * PoaDoctorsApiCredentialPanel's password), so the current value is shown
 * and pre-filled, not hidden.
 */
export function GoogleDriveConfigPanel() {
  const [state, setState] = useState<GoogleDriveConfigState | null>(null);
  const [surveyFolderId, setSurveyFolderId] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    getGoogleDriveConfigStateAction().then((s) => {
      setState(s);
      setSurveyFolderId(s.surveyFolderId ?? "");
    }).catch(() => setState({ surveyFolderId: null, updatedAt: null }));
  }, []);

  function save() {
    setError(null);
    if (!surveyFolderId.trim()) {
      setError("Folder ID wajib diisi.");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("surveyFolderId", surveyFolderId.trim());
      const res = await setGoogleDriveFolderIdAction(formData);
      if (!res.ok) { setError(res.error ?? "Gagal menyimpan."); return; }
      setSavedAt(Date.now());
      getGoogleDriveConfigStateAction().then(setState);
    });
  }

  if (!state) return null;

  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Folder Google Drive — Upload Dokumen</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
            ID folder shared drive tujuan upload &quot;Input Data Survey&quot; dan dokumen POA Standarisasi (Upload Memo, Surat Approval KFT, Form Approval).
            Ambil dari URL folder-nya di Google Drive (bagian setelah <code>/folders/</code>).
          </p>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap"
          style={{
            background: state.surveyFolderId ? "var(--color-green-light, #E6F5EC)" : "var(--color-warning-bg, #fef3c7)",
            color: state.surveyFolderId ? "var(--color-green, #008f42)" : "var(--color-warning, #f59e0b)",
          }}>
          {state.surveyFolderId ? "SUDAH DISET" : "BELUM DISET"}
        </span>
      </div>

      {state.updatedAt && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Diperbarui {new Date(state.updatedAt).toLocaleString("id-ID")}
        </p>
      )}

      <input
        type="text"
        value={surveyFolderId}
        onChange={(e) => setSurveyFolderId(e.target.value)}
        placeholder="Folder ID Google Drive"
        className="input-field text-sm w-full"
      />

      <Button type="button" size="sm" onClick={save} disabled={isPending}>
        {isPending ? "Menyimpan…" : "Simpan"}
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
