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
const EMPTY_STATE: GoogleDriveConfigState = {
  surveyFolderId: null, kftApprovalFolderId: null, formApprovalFolderId: null, spNonSalesFolderId: null,
  spNonSalesMemoKepada: null, spNonSalesMemoSignerHormatKami: null, spNonSalesMemoSignerMenyetujui: null, updatedAt: null,
};

export function GoogleDriveConfigPanel() {
  const [state, setState] = useState<GoogleDriveConfigState | null>(null);
  const [surveyFolderId, setSurveyFolderId] = useState("");
  const [kftApprovalFolderId, setKftApprovalFolderId] = useState("");
  const [formApprovalFolderId, setFormApprovalFolderId] = useState("");
  const [spNonSalesFolderId, setSpNonSalesFolderId] = useState("");
  const [memoKepada, setMemoKepada] = useState("");
  const [signerHormatKami, setSignerHormatKami] = useState("");
  const [signerMenyetujui, setSignerMenyetujui] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    getGoogleDriveConfigStateAction().then((s) => {
      setState(s);
      setSurveyFolderId(s.surveyFolderId ?? "");
      setKftApprovalFolderId(s.kftApprovalFolderId ?? "");
      setFormApprovalFolderId(s.formApprovalFolderId ?? "");
      setSpNonSalesFolderId(s.spNonSalesFolderId ?? "");
      setMemoKepada(s.spNonSalesMemoKepada ?? "");
      setSignerHormatKami(s.spNonSalesMemoSignerHormatKami ?? "");
      setSignerMenyetujui(s.spNonSalesMemoSignerMenyetujui ?? "");
    }).catch(() => setState(EMPTY_STATE));
  }, []);

  function save() {
    setError(null);
    if (!surveyFolderId.trim()) {
      setError("Folder ID Data Survey wajib diisi.");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("surveyFolderId", surveyFolderId.trim());
      formData.set("kftApprovalFolderId", kftApprovalFolderId.trim());
      formData.set("formApprovalFolderId", formApprovalFolderId.trim());
      formData.set("spNonSalesFolderId", spNonSalesFolderId.trim());
      formData.set("spNonSalesMemoKepada", memoKepada.trim());
      formData.set("spNonSalesMemoSignerHormatKami", signerHormatKami.trim());
      formData.set("spNonSalesMemoSignerMenyetujui", signerMenyetujui.trim());
      const res = await setGoogleDriveFolderIdAction(formData);
      if (!res.ok) { setError(res.error ?? "Gagal menyimpan."); return; }
      setSavedAt(Date.now());
      getGoogleDriveConfigStateAction().then(setState);
    });
  }

  if (!state) return null;

  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Folder Google Drive — Upload Dokumen</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
          Empat folder tujuan upload terpisah — Input Data Survey, Surat Approval Standarisasi KFT, Form Approval Standarisasi, dan Permintaan SP Non Sales.
          Ambil ID dari URL folder-nya di Google Drive (bagian setelah <code>/folders/</code>).
        </p>
      </div>

      {state.updatedAt && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Diperbarui {new Date(state.updatedAt).toLocaleString("id-ID")}
        </p>
      )}

      <div className="space-y-1">
        <label className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Input Data Survey (wajib)</label>
        <input
          type="text"
          value={surveyFolderId}
          onChange={(e) => setSurveyFolderId(e.target.value)}
          placeholder="Folder ID Google Drive"
          className="input-field text-sm w-full"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Surat Approval Standarisasi KFT</label>
        <input
          type="text"
          value={kftApprovalFolderId}
          onChange={(e) => setKftApprovalFolderId(e.target.value)}
          placeholder="Folder ID Google Drive"
          className="input-field text-sm w-full"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Form Approval Standarisasi</label>
        <input
          type="text"
          value={formApprovalFolderId}
          onChange={(e) => setFormApprovalFolderId(e.target.value)}
          placeholder="Folder ID Google Drive"
          className="input-field text-sm w-full"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Permintaan SP Non Sales</label>
        <input
          type="text"
          value={spNonSalesFolderId}
          onChange={(e) => setSpNonSalesFolderId(e.target.value)}
          placeholder="Folder ID Google Drive"
          className="input-field text-sm w-full"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Memo SP Non Sales — Nama Penerima (&quot;Kepada&quot;)</label>
        <input
          type="text"
          value={memoKepada}
          onChange={(e) => setMemoKepada(e.target.value)}
          placeholder="Nama fixed penerima memo"
          className="input-field text-sm w-full"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Memo SP Non Sales — Nama &quot;Hormat kami&quot;</label>
        <input
          type="text"
          value={signerHormatKami}
          onChange={(e) => setSignerHormatKami(e.target.value)}
          placeholder="Nama fixed di blok tanda tangan kiri"
          className="input-field text-sm w-full"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Memo SP Non Sales — Nama &quot;Menyetujui&quot;</label>
        <input
          type="text"
          value={signerMenyetujui}
          onChange={(e) => setSignerMenyetujui(e.target.value)}
          placeholder="Nama fixed di blok tanda tangan kanan"
          className="input-field text-sm w-full"
        />
      </div>

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
