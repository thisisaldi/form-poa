/**
 * Pengaturan fitur berbasis DB (tabel AppSetting) — lihat appSettingsRegistry.ts untuk daftar dan default.
 * Server-only. Dibaca di banyak tempat (layout, route, action), jadi di-cache singkat per proses; perubahan
 * dari halaman Admin langsung menghapus cache proses yang menjalankan action itu, dan replika lain ikut
 * sinkron dalam <= TTL. Gagal baca DB → pakai default registry (bukan error), sama seperti getMaintenanceState.
 */
import { prisma } from "@/lib/prisma";
import { APP_SETTINGS, defaultSettingValues, type AppSettingKey, type AppSettingValues } from "@/lib/appSettingsRegistry";

const TTL_MS = 10_000;
let cache: { values: AppSettingValues; expiresAt: number } | null = null;

export function invalidateAppSettingsCache(): void {
  cache = null;
}

export async function getAppSettings(): Promise<AppSettingValues> {
  if (cache && cache.expiresAt > Date.now()) return cache.values;
  const values = defaultSettingValues();
  try {
    const rows: { key: string; value: string }[] = await prisma.appSetting.findMany({ select: { key: true, value: true } });
    for (const r of rows) {
      if (r.key in values) values[r.key as AppSettingKey] = r.value === "true";
    }
  } catch (err) {
    console.error("[appSettings] failed to read AppSetting, using defaults:", err);
    return values; // tidak di-cache: coba lagi di request berikutnya
  }
  cache = { values, expiresAt: Date.now() + TTL_MS };
  return values;
}

export async function getAppSetting(key: AppSettingKey): Promise<boolean> {
  return (await getAppSettings())[key];
}

export async function setAppSetting(key: AppSettingKey, value: boolean, updatedByNip: string | null): Promise<void> {
  if (!APP_SETTINGS.some((d) => d.key === key)) throw new Error(`Pengaturan tidak dikenal: ${key}`);
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: String(value), updatedByNip },
    create: { key, value: String(value), updatedByNip },
  });
  invalidateAppSettingsCache();
}
