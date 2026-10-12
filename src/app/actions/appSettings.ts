"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getAppSettings, setAppSetting } from "@/lib/appSettings";
import { APP_SETTINGS, type AppSettingKey, type AppSettingValues } from "@/lib/appSettingsRegistry";

interface Result {
  ok: boolean;
  error?: string;
}

async function requireAdmin() {
  const session = await getCurrentUser();
  if (!session) throw new Error("Sesi tidak valid.");
  if (session.role !== "ADMIN") throw new Error("Hanya admin yang bisa mengubah pengaturan fitur.");
  return session;
}

export interface AppSettingRow {
  key: AppSettingKey;
  value: boolean;
  /** Sudah pernah diubah dari default? */
  overridden: boolean;
  updatedByNip: string | null;
  updatedAt: string | null;
}

/** Nilai efektif semua pengaturan beserta jejak perubahan terakhir (khusus ADMIN). */
export async function getAppSettingRowsAction(): Promise<AppSettingRow[]> {
  await requireAdmin();
  const [values, rows]: [AppSettingValues, { key: string; updatedByNip: string | null; updatedAt: Date }[]] = await Promise.all([
    getAppSettings(),
    prisma.appSetting.findMany({ select: { key: true, updatedByNip: true, updatedAt: true } }),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return APP_SETTINGS.map((d) => {
    const row = byKey.get(d.key);
    return {
      key: d.key,
      value: values[d.key],
      overridden: !!row,
      updatedByNip: row?.updatedByNip ?? null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  });
}

export async function setAppSettingAction(key: AppSettingKey, value: boolean): Promise<Result> {
  try {
    const session = await requireAdmin();
    await setAppSetting(key, value, session.userId);
    // Layout membaca pengaturan untuk FeatureFlagsProvider, jadi seluruh pohon perlu dirender ulang.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan." };
  }
}
