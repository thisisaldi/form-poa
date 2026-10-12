/**
 * Daftar pengaturan fitur yang bisa diubah ADMIN dari halaman Admin (Pengaturan Sistem → Pengaturan Fitur)
 * tanpa ubah kode/deploy. Pure (tanpa prisma), aman diimpor client. Nilai tersimpan di tabel AppSetting
 * (key → "true"/"false"); kalau belum ada barisnya, dipakai `default` di sini — jadi menambah pengaturan baru
 * cukup menambah satu entri di bawah, tanpa migrasi data.
 *
 * Konvensi: setting bertipe "kill switch" diberi akhiran `.disabled`/`Disabled` dan `true` = fitur MATI. Label ditulis
 * positif (nama fiturnya); panel Admin yang membalik tampilannya menjadi FITUR AKTIF / FITUR MATI.
 */

export type AppSettingGroup = "export" | "standarisasi";

export interface AppSettingDef {
  key: string;
  group: AppSettingGroup;
  label: string;
  description: string;
  /** Nilai bila belum pernah diubah (= perilaku sebelum pengaturan ini ada). */
  default: boolean;
  /** Pesan ke user saat fitur mati (kill switch) — dipakai server dan UI. */
  message?: string;
}

export const APP_SETTINGS = [
  {
    key: "export.poa.disabled",
    group: "export",
    label: "Export Excel POA Hospital",
    description: "/api/poa/[id]/export, /api/export/team, dan tombol export di dashboard dan halaman POA Hospital.",
    default: false,
    message: "Export Excel POA dinonaktifkan sementara. Silakan coba lagi nanti.",
  },
  {
    key: "export.sc.disabled",
    group: "export",
    label: "Export Excel POA Sales Counter (Non-Hospital)",
    description: "/api/sc/export, /api/sc/[id]/export, dan tombol export di dashboard dan halaman POA Sales Counter.",
    default: true,
    message: "Export Excel POA Sales Counter dinonaktifkan sementara. Silakan coba lagi nanti.",
  },
  {
    key: "export.team.periodAllDisabled",
    group: "export",
    label: "Export Excel semua periode (?period=all)",
    description: "Bila dimatikan, export tim hanya bisa per kuartal dan pilihan \"Semua Periode\" ditolak. Matikan bila export semua periode membuat memori pod penuh.",
    default: false,
    message: "Export semua periode dinonaktifkan sementara. Pilih satu kuartal.",
  },
  {
    key: "standarisasi.upload.disabled",
    group: "standarisasi",
    label: "Upload dokumen POA Standarisasi",
    description: "Upload Memo, Surat Approval Standarisasi KFT, dan Form Approval Standarisasi.",
    default: false,
    message: "Upload dokumen sedang dinonaktifkan sementara — coba lagi nanti.",
  },
  {
    key: "standarisasi.dplDpfSubmit.disabled",
    group: "standarisasi",
    label: "Pengajuan DPL/DPF ke Exodus",
    description: "Tombol \"Ajukan DPL/DPF\" di Step 5 POA Standarisasi.",
    default: false,
    message:
      "Pengajuan DPL/DPF dari sini belum tersedia — integrasi ke Exodus masih menunggu konfirmasi tim Exodus. Ajukan lewat sistem Exodus.",
  },
] as const satisfies readonly AppSettingDef[];

export type AppSettingKey = (typeof APP_SETTINGS)[number]["key"];

export const APP_SETTING_DEFS: Record<string, AppSettingDef> = Object.fromEntries(APP_SETTINGS.map((d) => [d.key, d]));

export const APP_SETTING_GROUP_LABELS: Record<AppSettingGroup, string> = {
  export: "Export Excel",
  standarisasi: "POA Standarisasi",
};

/** Peta key → nilai efektif; dikirim server → client lewat FeatureFlagsProvider. */
export type AppSettingValues = Record<AppSettingKey, boolean>;

export function defaultSettingValues(): AppSettingValues {
  return Object.fromEntries(APP_SETTINGS.map((d) => [d.key, d.default])) as AppSettingValues;
}

export function settingMessage(key: AppSettingKey): string {
  return APP_SETTING_DEFS[key]?.message ?? "Fitur ini dinonaktifkan sementara.";
}
