"use client";

import { createContext, useContext } from "react";
import { defaultSettingValues, settingMessage, type AppSettingKey, type AppSettingValues } from "@/lib/appSettingsRegistry";

/**
 * Nilai pengaturan fitur (AppSetting) untuk komponen client. Diisi sekali oleh (app)/layout.tsx dari DB,
 * jadi komponen cukup memanggil useFeatureFlag("export.poa.disabled") tanpa prop drilling dan tanpa konstanta
 * di kode. Di luar provider (mis. test/story) jatuh ke default registry.
 */
const FeatureFlagsContext = createContext<AppSettingValues>(defaultSettingValues());

export function FeatureFlagsProvider({ values, children }: { values: AppSettingValues; children: React.ReactNode }) {
  return <FeatureFlagsContext.Provider value={values}>{children}</FeatureFlagsContext.Provider>;
}

/** Nilai boolean satu pengaturan (untuk kill switch `.disabled`: true = fitur mati). */
export function useFeatureFlag(key: AppSettingKey): boolean {
  return useContext(FeatureFlagsContext)[key];
}

/** Pesan ke user untuk satu pengaturan (dari registry). */
export function featureFlagMessage(key: AppSettingKey): string {
  return settingMessage(key);
}
